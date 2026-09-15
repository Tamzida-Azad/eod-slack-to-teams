const fs = require('fs');
const path = require('path');
const config = require('./config');
const {
  dhakaParts,
  sameDay,
  addCalendarDays,
  isInEodMessageWindow,
  dateKey,
} = require('./eod-calendar');

function loadPlaywright() {
  const candidates = [
    path.join(config.rootDir, 'node_modules', 'playwright'),
    path.join(config.rootDir, '..', 'teams-slack-task-automation', 'node_modules', 'playwright'),
    path.join(config.rootDir, '..', 'daily-head-start', 'node_modules', 'playwright'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // continue
    }
  }
  throw new Error('Playwright not found — npm install in this project or teams-slack-task-automation');
}

/**
 * @param {{ year: number, month: number, day: number }} [targetDate]
 * @param {Date} [now]
 */
function getDateWindow(targetDate, now = new Date()) {
  const realToday = dhakaParts(now);
  const target = targetDate
    ? { year: targetDate.year, month: targetDate.month, day: targetDate.day }
    : { year: realToday.year, month: realToday.month, day: realToday.day };
  const isWeekend = realToday.weekday === 'Sat' || realToday.weekday === 'Sun';
  return {
    timezone: 'Asia/Dhaka',
    isWeekend,
    realToday: {
      year: realToday.year,
      month: realToday.month,
      day: realToday.day,
      weekday: realToday.weekday,
    },
    target,
    // alias used by older helpers
    today: target,
    label: `EOD window 12:00–11:20 for ${target.month}/${target.day}/${target.year} Asia/Dhaka`,
  };
}

function parseSlackTimestamp(text, realToday) {
  if (!text) return null;
  const t = String(text).trim().replace(/\.$/, '');

  // Explicit Today
  let m = t.match(/^Today(?:\s+at)?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    return {
      year: realToday.year,
      month: realToday.month,
      day: realToday.day,
      hour,
      minute: Number(m[2]),
      raw: t,
      relative: 'today',
    };
  }

  m = t.match(/^(?:Yesterday)(?:\s+at)?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    const y = addCalendarDays(realToday, -1);
    return {
      year: y.year,
      month: y.month,
      day: y.day,
      hour,
      minute: Number(m[2]),
      raw: t,
      relative: 'yesterday',
    };
  }

  // Full date in aria-label: September 3rd, 2026 at 9:38 PM / Sep 2nd at 10:23:08 PM
  m = t.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?.*?(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i
  );
  if (m) {
    const months = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    let hour = Number(m[4]) % 12;
    if (/pm/i.test(m[6])) hour += 12;
    const year = m[3] ? Number(m[3]) : realToday.year;
    return {
      year,
      month: months[m[1].toLowerCase()],
      day: Number(m[2]),
      hour,
      minute: Number(m[5]),
      raw: t,
    };
  }

  // M/D or M/D/YYYY
  m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  if (m) {
    const year = m[3] ? Number(m[3]) : realToday.year;
    let hour = null;
    let minute = null;
    if (m[4]) {
      hour = Number(m[4]) % 12;
      if (/pm/i.test(m[6])) hour += 12;
      minute = Number(m[5]);
    }
    return {
      year,
      month: Number(m[1]),
      day: Number(m[2]),
      hour,
      minute,
      raw: t,
    };
  }

  // Bare clock time — date unknown (rely on day divider)
  m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    return {
      raw: t,
      timeOnly: true,
      hour,
      minute: Number(m[2]),
    };
  }

  return { raw: t };
}

function normalizeDayContext(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  if (/^today$/i.test(t)) return 'today';
  if (/^yesterday$/i.test(t)) return 'yesterday';
  const m = t.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i
  );
  if (!m) return null;
  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  return {
    kind: 'date',
    month: months[m[1].toLowerCase()],
    day: Number(m[2]),
    year: m[3] ? Number(m[3]) : null,
  };
}

/**
 * Resolve absolute calendar day + clock for a scraped message.
 */
function resolveMessageDateTime(m, realToday) {
  const ts = m.parsedTimestamp;
  const dayCtx = m.dayContext;

  if (ts?.relative === 'today' || (ts?.year && sameDay(ts, realToday) && !ts.timeOnly)) {
    if (ts.hour != null) {
      return {
        year: realToday.year,
        month: realToday.month,
        day: realToday.day,
        hour: ts.hour,
        minute: ts.minute || 0,
      };
    }
  }

  if (ts?.relative === 'yesterday') {
    const y = addCalendarDays(realToday, -1);
    return {
      year: y.year,
      month: y.month,
      day: y.day,
      hour: ts.hour,
      minute: ts.minute || 0,
    };
  }

  if (ts && ts.year && ts.month && ts.day && !ts.timeOnly && ts.relative !== 'today') {
    return {
      year: ts.year,
      month: ts.month,
      day: ts.day,
      hour: ts.hour,
      minute: ts.minute || 0,
      hasTime: ts.hour != null,
    };
  }

  let base = null;
  if (dayCtx === 'today') base = realToday;
  else if (dayCtx === 'yesterday') base = addCalendarDays(realToday, -1);
  else if (dayCtx?.kind === 'date') {
    base = {
      year: dayCtx.year || realToday.year,
      month: dayCtx.month,
      day: dayCtx.day,
    };
  }

  if (base && ts?.timeOnly) {
    return {
      year: base.year,
      month: base.month,
      day: base.day,
      hour: ts.hour,
      minute: ts.minute || 0,
    };
  }

  if (base && !ts?.timeOnly && ts?.hour != null) {
    return {
      year: base.year,
      month: base.month,
      day: base.day,
      hour: ts.hour,
      minute: ts.minute || 0,
    };
  }

  // Bare time, no divider: assume realToday only (caller still applies target + window)
  if (ts?.timeOnly && !base) {
    return {
      year: realToday.year,
      month: realToday.month,
      day: realToday.day,
      hour: ts.hour,
      minute: ts.minute || 0,
      assumedToday: true,
    };
  }

  return null;
}

function inTargetDay(resolved, target) {
  if (!resolved || !target) return false;
  return sameDay(resolved, target);
}

/** @deprecated alias — kept for older tests */
function inToday(ts, window) {
  if (!ts) return false;
  if (ts.timeOnly) return false;
  if (ts.relative === 'yesterday') return false;
  if (ts.relative === 'today') return true;
  if (!ts.year) return false;
  return sameDay(ts, window.today || window.target);
}

function dayContextMatchesTarget(dayContext, window) {
  if (!dayContext) return null;
  const target = window.target;
  const real = window.realToday;
  if (dayContext === 'today') return sameDay(real, target);
  if (dayContext === 'yesterday') return sameDay(addCalendarDays(real, -1), target);
  if (dayContext.kind === 'date') {
    const year = dayContext.year || real.year;
    return year === target.year && dayContext.month === target.month && dayContext.day === target.day;
  }
  return null;
}

/**
 * Keep messages for target calendar day whose clock is in 12:00–11:20 Dhaka.
 */
function isTargetDayMessage(m, window) {
  const allowYesterdayHook = process.env.EOD_ALLOW_YESTERDAY === '1';
  const resolved = resolveMessageDateTime(m, window.realToday);
  const dayMatch = dayContextMatchesTarget(m.dayContext, window);

  if (allowYesterdayHook) {
    if (m.parsedTimestamp?.relative === 'yesterday') return true;
    if (dayMatch === false && m.dayContext === 'yesterday') return true;
  }

  if (!resolved) {
    // Under matching day divider with no clock — keep (rare)
    return dayMatch === true;
  }

  if (!inTargetDay(resolved, window.target)) return false;

  // Assumed-today bare times: only when target is actually today
  if (resolved.assumedToday && !sameDay(window.target, window.realToday)) return false;

  if (resolved.hasTime === false || resolved.hour == null) {
    return true;
  }

  return isInEodMessageWindow(resolved.hour, resolved.minute);
}

/** @deprecated name — use isTargetDayMessage */
function isTodaysMessage(m, window) {
  return isTargetDayMessage(m, window);
}

function dayContextIsToday(dayContext, window) {
  return dayContextMatchesTarget(dayContext, window);
}

function dhakaHour(date = new Date()) {
  return dhakaParts(date).hour;
}

async function openCalystaEod(page) {
  const channelId = process.env.SLACK_EOD_CHANNEL_ID || config.slack.channelId;
  if (channelId) {
    const url = `https://app.slack.com/client/${config.slack.teamId}/${channelId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation });
    await page.waitForTimeout(4500);
  } else {
    await page.goto(config.slack.workspaceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(4000);

    const sidebar = page.locator('[data-qa="channel_sidebar_name_calysta-eod"]').first();
    if (await sidebar.count()) {
      await sidebar.click({ timeout: config.timeouts.action });
      await page.waitForTimeout(4000);
    } else {
      throw new Error('Could not open #calysta-eod — set SLACK_EOD_CHANNEL_ID');
    }
  }

  const header = await page.locator('[data-qa="channel_name"]').innerText().catch(() => '');
  if (!/calysta-eod/i.test(header)) {
    throw new Error(`Expected #calysta-eod but channel header is "${header}"`);
  }
}

async function extractMessages(page, window) {
  // Scroll to bottom, then upward so older target days enter the virtual list
  await page.evaluate(() => {
    const panes = [
      ...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container, [class*="message_pane"]'),
    ];
    const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
    if (el) el.scrollTop = el.scrollHeight;
  }).catch(() => {});
  await page.waitForTimeout(1200);

  const daysBack = (() => {
    try {
      const t = Date.UTC(window.target.year, window.target.month - 1, window.target.day);
      const r = Date.UTC(window.realToday.year, window.realToday.month - 1, window.realToday.day);
      return Math.max(0, Math.round((r - t) / 86400000));
    } catch {
      return 0;
    }
  })();

  for (let i = 0; i < Math.min(daysBack * 4 + 2, 20); i += 1) {
    await page.evaluate(() => {
      const panes = [
        ...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container, [class*="message_pane"]'),
      ];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (el) el.scrollTop = Math.max(0, el.scrollTop - 900);
    }).catch(() => {});
    await page.waitForTimeout(700);
  }

  const raw = await page.evaluate(() => {
    const out = [];
    const seen = new Set();

    function isDayDivider(el) {
      if (!el || el.nodeType !== 1) return false;
      const qa = (el.getAttribute('data-qa') || '').toLowerCase();
      if (qa.includes('day_divider') || qa.includes('message_separator') || qa === 'sticky-date') {
        return true;
      }
      const cls = String(el.className || '');
      if (/day_divider|message_list__day/i.test(cls)) return true;
      return false;
    }

    function dividerLabel(el) {
      const label =
        el.querySelector('[data-qa="sticky-date"], .c-message_list__day_divider__label, button')?.textContent ||
        el.textContent ||
        '';
      return String(label).replace(/\s+/g, ' ').trim();
    }

    function readTimestamp(el) {
      const candidates = [
        ...el.querySelectorAll('a[aria-label], button[aria-label], [data-qa="message_timestamp"], .c-timestamp'),
      ];
      for (const node of candidates) {
        const aria = (node.getAttribute('aria-label') || '').trim();
        if (/\b(AM|PM)\b/i.test(aria) || /at\s+\d{1,2}:\d{2}/i.test(aria)) return aria;
      }
      return (
        el.querySelector('[data-qa="timestamp_label"]')?.textContent?.trim() ||
        el.querySelector('.c-timestamp__label')?.textContent?.trim() ||
        null
      );
    }

    const listRoot =
      document.querySelector('[data-qa="slack_kit_list"]') ||
      document.querySelector('.c-virtual_list__scroll_container') ||
      document.querySelector('[role="list"]') ||
      document.body;

    let dayContext = null;
    const walkRoots = listRoot.querySelectorAll(
      '[data-qa="message_container"], [data-qa*="day_divider"], [data-qa*="message_separator"], [data-qa="sticky-date"], [class*="day_divider"]'
    );

    for (const el of walkRoots) {
      if (isDayDivider(el) && !el.matches?.('[data-qa="message_container"]')) {
        const label = dividerLabel(el);
        if (label) dayContext = label;
        continue;
      }
      if (!el.matches?.('[data-qa="message_container"]') && el.getAttribute('data-qa') !== 'message_container') {
        if (isDayDivider(el)) continue;
        if (!el.querySelector?.('[data-qa="message-text"]')) continue;
      }
      if (el.getAttribute('data-qa') !== 'message_container') continue;

      const sender =
        el.querySelector('[data-qa="message_sender_name"]')?.textContent?.trim() ||
        el.querySelector('[data-qa="message_sender"]')?.textContent?.trim() ||
        null;

      const timestamp = readTimestamp(el);
      const body = (el.querySelector('[data-qa="message-text"]')?.innerText || '').trim();
      if (!body || body.length < 2) continue;
      if (/Zoom meeting started|Meeting ID:/i.test(body) && !/EOD/i.test(body)) continue;

      const key = `${sender}|${timestamp}|${body.slice(0, 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ author: sender, timestamp, body, dayContext });
    }

    if (out.length === 0) {
      const sticky =
        document.querySelector('[data-qa="sticky-date"]')?.textContent?.trim() ||
        document.querySelector('.c-message_list__day_divider__label')?.textContent?.trim() ||
        null;
      for (const el of document.querySelectorAll('[data-qa="message_container"]')) {
        const sender =
          el.querySelector('[data-qa="message_sender_name"]')?.textContent?.trim() ||
          el.querySelector('[data-qa="message_sender"]')?.textContent?.trim() ||
          null;
        const timestamp = readTimestamp(el);
        const body = (el.querySelector('[data-qa="message-text"]')?.innerText || '').trim();
        if (!body || body.length < 2) continue;
        if (/Zoom meeting started|Meeting ID:/i.test(body) && !/EOD/i.test(body)) continue;
        const key = `${sender}|${timestamp}|${body.slice(0, 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ author: sender, timestamp, body, dayContext: sticky });
      }
    }

    return out;
  });

  return raw
    .map((m) => {
      const parsedTimestamp = parseSlackTimestamp(m.timestamp, window.realToday);
      const dayContext = normalizeDayContext(m.dayContext);
      return {
        author: m.author,
        timestamp: m.timestamp,
        parsedTimestamp,
        dayContext,
        dayContextRaw: m.dayContext || null,
        body: cleanBody(m.body),
      };
    })
    .filter((m) => m.body && m.body.length > 2)
    .filter((m) => isTargetDayMessage(m, window));
}

function cleanBody(body) {
  return String(body || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitRawBlocks(messages, window) {
  const refined = [];
  for (const m of messages) {
    if (!m.rawBlock && m.author) {
      refined.push(m);
      continue;
    }
    const text = m.body;
    const match = text.match(/^(.+?)\s{1,3}(?:\[)?(\d{1,2}:\d{2}\s*[AP]M)(?:\])?\s*\n([\s\S]+)$/i);
    if (match) {
      const ts = parseSlackTimestamp(match[2], window.realToday);
      refined.push({
        author: match[1].trim(),
        timestamp: match[2],
        parsedTimestamp: ts,
        dayContext: m.dayContext || null,
        body: cleanBody(match[3]),
      });
    } else if (m.author) {
      refined.push(m);
    }
  }
  return refined.filter((m) => isTargetDayMessage(m, window));
}

async function scrapeSlackEod(options = {}) {
  const { chromium } = loadPlaywright();
  const headed = options.headed === true || process.env.EOD_HEADED === '1';
  const targetDate = options.targetDate || null;
  const window = getDateWindow(targetDate);

  // Only skip when scraping "today" on a weekend (backfill of weekdays still runs)
  if (!targetDate && window.isWeekend) {
    return {
      skipped: true,
      reason: 'weekend',
      window,
      messages: [],
      stats: { messagesKept: 0 },
    };
  }

  if (!fs.existsSync(config.paths.browserProfile)) {
    throw new Error(`Missing browser profile: ${config.paths.browserProfile}`);
  }

  const context = await chromium.launchPersistentContext(config.paths.browserProfile, {
    headless: !headed,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  let messages = [];
  try {
    await openCalystaEod(page);

    const body = await page.locator('body').innerText().catch(() => '');
    if (/sign in to your workspace|enter your email|magic code/i.test(body.slice(0, 600))) {
      throw new Error('Slack login wall — sign in using teams-slack-task-automation npm run save-auth');
    }

    messages = await extractMessages(page, window);
    messages = splitRawBlocks(messages, window);
    messages = messages.filter((m) => m.author && m.body);

    const eodLike = messages.filter((m) => /EOD|#\d+|verified|progress|deployed/i.test(m.body));
    if (eodLike.length > 0) messages = eodLike;
  } finally {
    await context.close();
  }

  const payload = {
    scrapedAt: new Date().toISOString(),
    window,
    targetDate: window.target,
    targetDateKey: dateKey(window.target),
    channel: config.slack.channelName,
    messages,
    stats: {
      messagesKept: messages.length,
      authors: [...new Set(messages.map((m) => m.author))],
    },
  };

  fs.mkdirSync(config.paths.logsDir, { recursive: true });
  fs.writeFileSync(config.paths.messagesJson, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

module.exports = {
  scrapeSlackEod,
  getDateWindow,
  parseSlackTimestamp,
  inToday,
  isTodaysMessage,
  isTargetDayMessage,
  normalizeDayContext,
  dayContextIsToday,
  dayContextMatchesTarget,
  resolveMessageDateTime,
  dhakaHour,
};

if (require.main === module) {
  const target = process.env.EOD_TARGET_DATE
    ? (() => {
        const [y, m, d] = process.env.EOD_TARGET_DATE.split('-').map(Number);
        return { year: y, month: m, day: d };
      })()
    : null;
  scrapeSlackEod({ headed: process.env.EOD_HEADED === '1', targetDate: target })
    .then((r) => {
      console.log(JSON.stringify(r.stats || r, null, 2));
      console.log('Wrote', config.paths.messagesJson);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
