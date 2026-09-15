/**
 * EOD orchestrator — shared by CLI and Vercel API.
 * Serverless / cron: one attempt per day per invocation (no long sleep).
 * Local CLI: optional multi-retry loop with sleep (legacy gatekeeper).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { scrapeSlackEod } = require('./scrape-slack');
const { formatEod } = require('./format-eod');
const { postToTeams } = require('./post-teams');
const {
  listDaysNeedingPost,
  mmddyyyy,
  targetDateToJsDate,
  dhakaParts,
} = require('./eod-calendar');
const {
  createStateStore,
  ensureBaseline,
  markPosted,
  markEmpty,
  markAttempt,
  markFailed,
  saveState,
} = require('./eod-state');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLogger(options = {}) {
  const silent = options.silent === true;
  const writeFiles = options.writeFiles !== false;
  let filePath = null;
  if (writeFiles) {
    try {
      fs.mkdirSync(config.paths.logsDir, { recursive: true });
      filePath = path.join(config.paths.logsDir, `pipeline-${stamp()}.log`);
    } catch {
      filePath = null;
    }
  }
  const write = (level, message, extra) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...(extra || {}),
    });
    if (filePath) {
      try {
        fs.appendFileSync(filePath, `${line}\n`);
      } catch {
        // ignore
      }
    }
    if (!silent) {
      const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
      console.log(`[${prefix}] ${message}`);
    }
  };
  return {
    filePath,
    silent,
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}

function retryIntervalMs() {
  if (process.env.EOD_RETRY_INTERVAL_MS) {
    return Number(process.env.EOD_RETRY_INTERVAL_MS);
  }
  return config.eod.retryIntervalMinutes * 60 * 1000;
}

function canAttemptNow(state, dayKey, now = new Date()) {
  const entry = state.days?.[dayKey];
  if (!entry) return { ok: true, attempt: 1 };
  const attempts = Number(entry.attempts || 0);
  const maxAttempts = config.eod.maxAttempts;
  if (attempts >= maxAttempts && entry.status === 'pending') {
    return { ok: false, reason: 'max_attempts', attempt: attempts };
  }
  if (entry.lastAttemptAt) {
    const elapsed = now.getTime() - new Date(entry.lastAttemptAt).getTime();
    if (elapsed < retryIntervalMs()) {
      return {
        ok: false,
        reason: 'retry_wait',
        attempt: attempts,
        waitMs: retryIntervalMs() - elapsed,
      };
    }
  }
  return { ok: true, attempt: attempts + 1 };
}

/**
 * One scrape → format → Teams attempt for a single calendar day.
 */
async function attemptDay(day, log, dryRun, deps = {}) {
  const scrapeFn = deps.scrapeSlackEod || scrapeSlackEod;
  const postFn = deps.postToTeams || postToTeams;
  const writeFiles = deps.writeFiles !== false;

  const targetDate = { year: day.year, month: day.month, day: day.day };
  const dateLabel = mmddyyyy(targetDate);

  log.info(`Scraping Slack for ${dateLabel}`, { key: day.key, catchUp: day.catchUp });
  const scrape = await scrapeFn({
    targetDate,
    now: deps.now,
    fetchImpl: deps.fetchImpl,
    writeFiles,
    accessToken: deps.slackAccessToken,
    tokens: deps.oauthTokens,
  });

  if (scrape.skipped) {
    return { ok: false, error: scrape.reason || 'skipped' };
  }

  const formatted = formatEod(scrape, {
    date: targetDateToJsDate(targetDate),
    dateLabel,
    catchUp: day.catchUp,
  });

  if (writeFiles) {
    try {
      fs.mkdirSync(config.paths.logsDir, { recursive: true });
      const dayLog = path.join(config.paths.logsDir, `eod-payload-${day.key}.txt`);
      fs.writeFileSync(dayLog, formatted.payloadText, 'utf8');
      fs.writeFileSync(config.paths.payloadTxt, formatted.payloadText, 'utf8');
      fs.writeFileSync(config.paths.payloadHtml, formatted.payloadHtml, 'utf8');
    } catch {
      // ignore fs errors on serverless read-only except /tmp — caller may disable writeFiles
    }
  }

  log.info('Format complete', {
    date: formatted.date,
    personCount: formatted.personCount,
    updateCount: formatted.updateCount,
    catchUp: day.catchUp,
  });

  if (dryRun) {
    if (!log.silent) {
      console.log(`\n----- EOD PAYLOAD PREVIEW (${dateLabel}) -----\n`);
      console.log(formatted.payloadText);
      console.log('\n----- END PREVIEW -----\n');
    }
    return {
      ok: true,
      empty: formatted.updateCount === 0,
      updateCount: formatted.updateCount,
      dryRun: true,
      formatted,
    };
  }

  if (formatted.updateCount === 0) {
    log.warn(`No EOD updates in 12:00–11:20 window for ${dateLabel} — marking empty`);
    return { ok: true, empty: true, updateCount: 0, formatted };
  }

  log.info(`Posting ${dateLabel} to Teams ${config.teams.channelName}`);
  const posted = await postFn(formatted.payloadText, formatted.payloadHtml, {
    blocks: formatted.blocks,
    dryRun: false,
    fetchImpl: deps.fetchImpl,
    accessToken: deps.teamsAccessToken,
    tokens: deps.oauthTokens,
  });
  log.info('Teams post complete', { date: dateLabel, ...posted });
  return { ok: true, empty: false, updateCount: formatted.updateCount, posted, formatted };
}

/**
 * Gatekeeper with in-process sleeps (local CLI).
 */
async function processDayWithRetries(day, state, log, dryRun, deps = {}) {
  const store = deps.store;
  const maxAttempts = config.eod.maxAttempts;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log.info(`Gatekeeper attempt ${attempt}/${maxAttempts} for ${day.key}`, {
      catchUp: day.catchUp,
    });

    try {
      const result = await attemptDay(day, log, dryRun, deps);
      if (!result.ok) {
        lastError = result.error || 'attempt failed';
        if (!dryRun) await markAttempt(state, day.key, attempt, lastError, store);
      } else if (result.empty) {
        if (!dryRun) await markEmpty(state, day.key, { attempts: attempt, catchUp: day.catchUp }, store);
        log.info(`Day ${day.key} complete (empty)`);
        return { status: 'empty', attempts: attempt };
      } else {
        if (!dryRun) {
          await markPosted(
            state,
            day.key,
            { attempts: attempt, updateCount: result.updateCount, catchUp: day.catchUp },
            store
          );
        }
        log.info(`Day ${day.key} posted successfully on attempt ${attempt}`);
        return { status: 'posted', attempts: attempt, updateCount: result.updateCount };
      }
    } catch (error) {
      lastError = error?.message || String(error);
      log.error(`Attempt ${attempt} failed for ${day.key}`, { error: lastError });
      if (!dryRun) await markAttempt(state, day.key, attempt, lastError, store);
    }

    if (attempt < maxAttempts) {
      log.warn(
        `Retrying ${day.key} in ${config.eod.retryIntervalMinutes} minutes (attempt ${attempt}/${maxAttempts} failed)`
      );
      await sleep(retryIntervalMs());
    }
  }

  if (!dryRun) await markFailed(state, day.key, maxAttempts, lastError, store);
  log.error(`Gave up on ${day.key} after ${maxAttempts} attempts`, { lastError });
  return { status: 'failed', attempts: maxAttempts, error: lastError };
}

/**
 * One-shot: at most one attempt per pending day (for Vercel cron / API).
 * Respects maxAttempts + retry interval via state.lastAttemptAt.
 */
async function processDayOnce(day, state, log, dryRun, deps = {}) {
  const store = deps.store;
  const now = deps.now || new Date();
  const gate = canAttemptNow(state, day.key, now);

  if (!gate.ok) {
    log.info(`Skipping ${day.key}`, { reason: gate.reason, waitMs: gate.waitMs });
    if (gate.reason === 'max_attempts') {
      const lastError = state.days[day.key]?.lastError || 'max attempts';
      if (!dryRun && state.days[day.key]?.status !== 'failed') {
        await markFailed(state, day.key, gate.attempt, lastError, store);
      }
      return { status: 'failed', attempts: gate.attempt, error: lastError, skipped: true };
    }
    return { status: 'waiting', attempts: gate.attempt, waitMs: gate.waitMs, skipped: true };
  }

  const attempt = gate.attempt;
  log.info(`One-shot attempt ${attempt}/${config.eod.maxAttempts} for ${day.key}`, {
    catchUp: day.catchUp,
  });

  try {
    const result = await attemptDay(day, log, dryRun, deps);
    if (!result.ok) {
      const lastError = result.error || 'attempt failed';
      if (!dryRun) await markAttempt(state, day.key, attempt, lastError, store);
      if (attempt >= config.eod.maxAttempts && !dryRun) {
        await markFailed(state, day.key, attempt, lastError, store);
        return { status: 'failed', attempts: attempt, error: lastError };
      }
      return { status: 'pending', attempts: attempt, error: lastError };
    }
    if (result.empty) {
      if (!dryRun) await markEmpty(state, day.key, { attempts: attempt, catchUp: day.catchUp }, store);
      return { status: 'empty', attempts: attempt };
    }
    if (!dryRun) {
      await markPosted(
        state,
        day.key,
        { attempts: attempt, updateCount: result.updateCount, catchUp: day.catchUp },
        store
      );
    }
    return { status: 'posted', attempts: attempt, updateCount: result.updateCount };
  } catch (error) {
    const lastError = error?.message || String(error);
    log.error(`Attempt failed for ${day.key}`, { error: lastError });
    if (!dryRun) await markAttempt(state, day.key, attempt, lastError, store);
    if (attempt >= config.eod.maxAttempts && !dryRun) {
      await markFailed(state, day.key, attempt, lastError, store);
      return { status: 'failed', attempts: attempt, error: lastError };
    }
    return { status: 'pending', attempts: attempt, error: lastError };
  }
}

/**
 * @param {{
 *   dryRun?: boolean,
 *   now?: Date,
 *   mode?: 'once' | 'retries',
 *   store?: object,
 *   writeFiles?: boolean,
 *   silent?: boolean,
 *   scrapeSlackEod?: Function,
 *   postToTeams?: Function,
 *   fetchImpl?: Function,
 * }} options
 */
async function runDaily(options = {}) {
  const dryRun = options.dryRun === true || process.env.EOD_DRY_RUN === '1';
  const now = options.now || new Date();
  const mode = options.mode || 'once';
  const store = options.store || createStateStore({ filePath: options.stateFile });
  const log = createLogger({
    silent: options.silent,
    writeFiles: options.writeFiles !== false && store.kind === 'file',
  });

  let state = await store.load();
  state = await ensureBaseline(state, now, store);

  const { getIntegrationsStatus } = require('./token-store');
  const { getValidSlackAccessToken } = require('./oauth-slack');
  const { getValidTeamsAccessToken } = require('./oauth-teams');

  let oauthTokens = options.oauthTokens || null;
  let slackAccessToken = options.slackAccessToken || null;
  let teamsAccessToken = options.teamsAccessToken || null;
  let integrations = null;

  // When using real scrape/post (not injected mocks), require user OAuth
  if (!options.scrapeSlackEod || !options.postToTeams) {
    integrations = await getIntegrationsStatus(now);
    if (!integrations.ok) {
      const message = integrations.error || 'oauth token store unavailable';
      log.error(message);
      return { ok: false, results: [], days: [], state, message, integrations };
    }
    if (integrations.slack.status !== 'connected') {
      const message = `Slack ${integrations.slack.status} — connect at /integrations/slack`;
      log.error(message);
      state.lastRun = { at: new Date().toISOString(), dryRun, results: [], message };
      await saveState(state, store);
      return { ok: false, results: [], days: [], state, message, integrations };
    }
    if (!dryRun && integrations.teams.status !== 'connected') {
      const message = `Teams ${integrations.teams.status} — connect at /integrations/teams`;
      log.error(message);
      state.lastRun = { at: new Date().toISOString(), dryRun, results: [], message };
      await saveState(state, store);
      return { ok: false, results: [], days: [], state, message, integrations };
    }
    try {
      if (!slackAccessToken && !options.scrapeSlackEod) {
        slackAccessToken = await getValidSlackAccessToken({ fetchImpl: options.fetchImpl });
      }
      if (!dryRun && !teamsAccessToken && !options.postToTeams) {
        teamsAccessToken = await getValidTeamsAccessToken({ fetchImpl: options.fetchImpl });
      }
    } catch (e) {
      const message = e.message || String(e);
      log.error(message);
      state.lastRun = { at: new Date().toISOString(), dryRun, results: [], message };
      await saveState(state, store);
      return { ok: false, results: [], days: [], state, message, integrations };
    }
  }

  const deps = {
    store,
    now,
    writeFiles: options.writeFiles !== false && store.kind === 'file',
    scrapeSlackEod: options.scrapeSlackEod,
    postToTeams: options.postToTeams,
    fetchImpl: options.fetchImpl,
    oauthTokens,
    slackAccessToken,
    teamsAccessToken,
  };

  log.info('Starting EOD Slack → Teams pipeline', {
    dryRun,
    mode,
    dhaka: dhakaParts(now),
    stateBackend: store.kind,
    maxAttempts: config.eod.maxAttempts,
    slack: integrations?.slack?.status || 'injected',
    teams: integrations?.teams?.status || 'injected',
  });

  const days = listDaysNeedingPost(state, now);
  if (days.length === 0) {
    log.info('No EOD days need posting right now');
    state.lastRun = {
      at: new Date().toISOString(),
      dryRun,
      results: [],
      message: 'nothing due',
    };
    await saveState(state, store);
    return { ok: true, results: [], days: [], state, message: 'nothing due', integrations };
  }

  log.info('Days to process', {
    days: days.map((d) => ({ key: d.key, catchUp: d.catchUp, date: mmddyyyy(d) })),
  });

  const results = [];
  for (const day of days) {
    const result =
      mode === 'retries'
        ? await processDayWithRetries(day, state, log, dryRun, deps)
        : await processDayOnce(day, state, log, dryRun, deps);
    results.push({ key: day.key, catchUp: day.catchUp, ...result });
  }

  state.lastRun = {
    at: new Date().toISOString(),
    dryRun,
    results,
  };
  await saveState(state, store);

  log.info('Pipeline finished', { results });
  const failed = results.filter((r) => r.status === 'failed' && !r.skipped);
  return {
    ok: failed.length === 0,
    results,
    days,
    state,
    failed,
    integrations,
  };
}

async function main() {
  const mode = process.env.EOD_MODE === 'once' ? 'once' : 'retries';
  const result = await runDaily({
    dryRun: process.env.EOD_DRY_RUN === '1',
    mode,
  });
  if (!result.ok) {
    console.error('\nFAILED days:', (result.failed || []).map((f) => f.key).join(', '));
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
  runDaily,
  attemptDay,
  processDayWithRetries,
  processDayOnce,
  canAttemptNow,
  createLogger,
  retryIntervalMs,
};
