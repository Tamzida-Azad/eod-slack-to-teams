/**
 * Slack day/window helpers (browser-independent).
 * Shared by API scrape and golden filter tests.
 */
const {
  dhakaParts,
  sameDay,
  addCalendarDays,
  isInEodMessageWindow,
  dateKey,
} = require('./eod-calendar');

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
    today: target,
    label: `EOD window 12:00–11:20 for ${target.month}/${target.day}/${target.year} Asia/Dhaka`,
  };
}

function parseSlackTimestamp(text, realToday) {
  if (!text) return null;
  const t = String(text).trim().replace(/\.$/, '');

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

  m = t.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?.*?(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i
  );
  if (m) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12,
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
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };
  return {
    kind: 'date',
    month: months[m[1].toLowerCase()],
    day: Number(m[2]),
    year: m[3] ? Number(m[3]) : null,
  };
}

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

function isTargetDayMessage(m, window) {
  const allowYesterdayHook = process.env.EOD_ALLOW_YESTERDAY === '1';
  const resolved = resolveMessageDateTime(m, window.realToday);
  const dayMatch = dayContextMatchesTarget(m.dayContext, window);

  if (allowYesterdayHook) {
    if (m.parsedTimestamp?.relative === 'yesterday') return true;
    if (dayMatch === false && m.dayContext === 'yesterday') return true;
  }

  if (!resolved) {
    return dayMatch === true;
  }

  if (!inTargetDay(resolved, window.target)) return false;

  if (resolved.assumedToday && !sameDay(window.target, window.realToday)) return false;

  if (resolved.hasTime === false || resolved.hour == null) {
    return true;
  }

  return isInEodMessageWindow(resolved.hour, resolved.minute);
}

function isTodaysMessage(m, window) {
  return isTargetDayMessage(m, window);
}

function dayContextIsToday(dayContext, window) {
  return dayContextMatchesTarget(dayContext, window);
}

function dhakaHour(date = new Date()) {
  return dhakaParts(date).hour;
}

/** Prefer EOD-like bodies when mixed content is present (same rule as legacy scrape). */
function preferEodLikeMessages(messages) {
  const eodLike = (messages || []).filter((m) =>
    /EOD|#\d+|verified|progress|deployed/i.test(m.body)
  );
  return eodLike.length > 0 ? eodLike : messages || [];
}

/**
 * Asia/Dhaka local wall time → unix seconds (Dhaka is UTC+6, no DST).
 */
function dhakaLocalToUnix(year, month, day, hour, minute, second = 0) {
  return Math.floor(Date.UTC(year, month - 1, day, hour - 6, minute, second) / 1000);
}

function unixToDhakaParts(tsSeconds) {
  return dhakaParts(new Date(Number(tsSeconds) * 1000));
}

function isMessageInTargetWindow(tsSeconds, target) {
  const p = unixToDhakaParts(tsSeconds);
  if (!sameDay(p, target)) return false;
  return isInEodMessageWindow(p.hour, p.minute);
}

function formatClock12(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}:${String(minute).padStart(2, '0')} ${period}`;
}

module.exports = {
  getDateWindow,
  parseSlackTimestamp,
  normalizeDayContext,
  resolveMessageDateTime,
  inToday,
  isTodaysMessage,
  isTargetDayMessage,
  dayContextIsToday,
  dayContextMatchesTarget,
  dhakaHour,
  preferEodLikeMessages,
  dhakaLocalToUnix,
  unixToDhakaParts,
  isMessageInTargetWindow,
  formatClock12,
  dateKey,
};
