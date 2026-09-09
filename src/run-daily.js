const fs = require('fs');
const path = require('path');
const config = require('./config');
const { scrapeSlackEod } = require('./scrape-slack-eod');
const { formatEod } = require('./format-eod');
const { postToTeams } = require('./post-teams');
const {
  listDaysNeedingPost,
  mmddyyyy,
  targetDateToJsDate,
  dhakaParts,
} = require('./eod-calendar');
const {
  loadState,
  ensureBaseline,
  markPosted,
  markEmpty,
  markAttempt,
  markFailed,
} = require('./eod-state');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLogger() {
  fs.mkdirSync(config.paths.logsDir, { recursive: true });
  const filePath = path.join(config.paths.logsDir, `pipeline-${stamp()}.log`);
  const write = (level, message, extra) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...(extra || {}),
    });
    fs.appendFileSync(filePath, `${line}\n`);
    const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
    console.log(`[${prefix}] ${message}`);
  };
  return {
    filePath,
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}

/**
 * One scrape → format → Teams attempt for a single calendar day.
 * @returns {{ ok: boolean, empty?: boolean, updateCount?: number, error?: string, formatted?: object }}
 */
async function attemptDay(day, log, dryRun) {
  const targetDate = { year: day.year, month: day.month, day: day.day };
  const dateLabel = mmddyyyy(targetDate);

  log.info(`Scraping Slack for ${dateLabel}`, { key: day.key, catchUp: day.catchUp });
  const scrape = await scrapeSlackEod({
    headed: process.env.EOD_HEADED === '1',
    targetDate,
  });

  if (scrape.skipped) {
    return { ok: false, error: scrape.reason || 'skipped' };
  }

  const formatted = formatEod(scrape, {
    date: targetDateToJsDate(targetDate),
    dateLabel,
    catchUp: day.catchUp,
  });

  const dayLog = path.join(config.paths.logsDir, `eod-payload-${day.key}.txt`);
  fs.writeFileSync(dayLog, formatted.payloadText, 'utf8');
  fs.writeFileSync(config.paths.payloadTxt, formatted.payloadText, 'utf8');
  fs.writeFileSync(config.paths.payloadHtml, formatted.payloadHtml, 'utf8');

  log.info('Format complete', {
    date: formatted.date,
    personCount: formatted.personCount,
    updateCount: formatted.updateCount,
    catchUp: day.catchUp,
  });

  if (dryRun) {
    console.log(`\n----- EOD PAYLOAD PREVIEW (${dateLabel}) -----\n`);
    console.log(formatted.payloadText);
    console.log('\n----- END PREVIEW -----\n');
    return { ok: true, empty: formatted.updateCount === 0, updateCount: formatted.updateCount, dryRun: true };
  }

  if (formatted.updateCount === 0) {
    log.warn(`No EOD updates in 12:00–11:20 window for ${dateLabel} — marking empty`);
    return { ok: true, empty: true, updateCount: 0 };
  }

  log.info(`Posting ${dateLabel} to Teams Calystapro EMR Web Dev`);
  const posted = await postToTeams(formatted.payloadText, formatted.payloadHtml, {
    headed: process.env.EOD_HEADED === '1',
    blocks: formatted.blocks,
  });
  log.info('Teams post complete', { date: dateLabel, ...posted });
  return { ok: true, empty: false, updateCount: formatted.updateCount, posted };
}

/**
 * Gatekeeper: up to maxAttempts, 10 min apart; stop on first success.
 */
async function processDayWithRetries(day, state, log, dryRun) {
  const maxAttempts = config.eod.maxAttempts;
  const intervalMs = config.eod.retryIntervalMinutes * 60 * 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log.info(`Gatekeeper attempt ${attempt}/${maxAttempts} for ${day.key}`, {
      catchUp: day.catchUp,
    });

    try {
      const result = await attemptDay(day, log, dryRun);
      if (!result.ok) {
        lastError = result.error || 'attempt failed';
        markAttempt(state, day.key, attempt, lastError);
      } else if (result.empty) {
        if (!dryRun) markEmpty(state, day.key, { attempts: attempt, catchUp: day.catchUp });
        log.info(`Day ${day.key} complete (empty)`);
        return { status: 'empty', attempts: attempt };
      } else {
        if (!dryRun) {
          markPosted(state, day.key, {
            attempts: attempt,
            updateCount: result.updateCount,
            catchUp: day.catchUp,
          });
        }
        log.info(`Day ${day.key} posted successfully on attempt ${attempt}`);
        return { status: 'posted', attempts: attempt, updateCount: result.updateCount };
      }
    } catch (error) {
      lastError = error?.message || String(error);
      log.error(`Attempt ${attempt} failed for ${day.key}`, { error: lastError });
      markAttempt(state, day.key, attempt, lastError);
    }

    if (attempt < maxAttempts) {
      log.warn(
        `Retrying ${day.key} in ${config.eod.retryIntervalMinutes} minutes (attempt ${attempt}/${maxAttempts} failed)`
      );
      if (process.env.EOD_RETRY_INTERVAL_MS) {
        await sleep(Number(process.env.EOD_RETRY_INTERVAL_MS));
      } else {
        await sleep(intervalMs);
      }
    }
  }

  if (!dryRun) markFailed(state, day.key, maxAttempts, lastError);
  log.error(`Gave up on ${day.key} after ${maxAttempts} attempts`, { lastError });
  return { status: 'failed', attempts: maxAttempts, error: lastError };
}

async function main() {
  const log = createLogger();
  const dryRun = process.env.EOD_DRY_RUN === '1';
  const now = new Date();
  const state = ensureBaseline(loadState(), now);

  log.info('Starting EOD Slack → Teams pipeline (gatekeeper + backfill)', {
    dryRun,
    dhaka: dhakaParts(now),
    profile: config.paths.browserProfile,
    logFile: log.filePath,
    maxAttempts: config.eod.maxAttempts,
    retryIntervalMinutes: config.eod.retryIntervalMinutes,
  });

  const days = listDaysNeedingPost(state, now);
  if (days.length === 0) {
    log.info('No EOD days need posting right now (nothing missed; today not yet due before 11:30 PM)');
    return;
  }

  log.info('Days to process', {
    days: days.map((d) => ({ key: d.key, catchUp: d.catchUp, date: mmddyyyy(d) })),
  });

  const results = [];
  for (const day of days) {
    const result = await processDayWithRetries(day, state, log, dryRun);
    results.push({ key: day.key, ...result });
  }

  log.info('Pipeline finished', { results });
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length) {
    console.error('\nFAILED days:', failed.map((f) => f.key).join(', '));
    process.exitCode = 1;
    return;
  }

  console.log('\nSUCCESS: EOD Slack → Teams pipeline completed');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  main,
  attemptDay,
  processDayWithRetries,
};