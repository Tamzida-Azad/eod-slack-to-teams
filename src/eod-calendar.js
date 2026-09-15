/**
 * Asia/Dhaka calendar helpers for EOD Slack → Teams.
 * EOD message window: 12:00 PM – 11:20 PM (inclusive).
 * Post schedule: Mon–Fri 11:30 PM.
 */

const TIMEZONE = 'Asia/Dhaka';
const EOD_WINDOW_START_MIN = 12 * 60; // 12:00 PM
const EOD_WINDOW_END_MIN = 23 * 60 + 20; // 11:20 PM
const SCHEDULE_HOUR = 23;
const SCHEDULE_MINUTE = 30;
/** Calendar days to scan for missed weekdays (override with EOD_LOOKBACK_DAYS). */
const MAX_LOOKBACK_DAYS = 7;

function dhakaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function dateKey(parts) {
  const y = parts.year;
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const m = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date key: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function mmddyyyy(parts) {
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${m}/${d}/${parts.year}`;
}

function isWeekday(parts) {
  return !['Sat', 'Sun'].includes(parts.weekday);
}

function addCalendarDays(parts, deltaDays) {
  // Dhaka has no DST — UTC noon+offset proxy is stable for calendar math
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays, 6, 0, 0));
  return dhakaParts(utc);
}

function sameDay(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function minutesOfDay(hour, minute) {
  return Number(hour) * 60 + Number(minute || 0);
}

/** True if time is within 12:00 PM – 11:20 PM Asia/Dhaka */
function isInEodMessageWindow(hour, minute) {
  if (hour == null || Number.isNaN(Number(hour))) return false;
  const mins = minutesOfDay(hour, minute);
  return mins >= EOD_WINDOW_START_MIN && mins <= EOD_WINDOW_END_MIN;
}

/** True if current Dhaka time is at/after Mon–Fri 11:30 PM schedule */
function isAtOrAfterSchedule(now = new Date()) {
  const p = dhakaParts(now);
  if (!isWeekday(p)) return false;
  return minutesOfDay(p.hour, p.minute) >= minutesOfDay(SCHEDULE_HOUR, SCHEDULE_MINUTE);
}

function isDayComplete(state, key) {
  const entry = state?.days?.[key];
  if (!entry) return false;
  // failed = exhausted gatekeeper; do not keep auto-retrying forever
  return entry.status === 'posted' || entry.status === 'empty' || entry.status === 'failed';
}

/**
 * Weekdays that still need an EOD Teams post.
 * - Past weekdays in lookback whose status is not posted/empty/failed
 * - Today (weekday) only if at/after 11:30 PM or forceToday
 * - Never before state.baselineKey (set on first run to avoid flooding history)
 */
function listDaysNeedingPost(state, now = new Date(), options = {}) {
  const forceToday = options.forceToday === true || process.env.EOD_FORCE_TODAY === '1';
  const lookback = Number(options.lookbackDays || process.env.EOD_LOOKBACK_DAYS || MAX_LOOKBACK_DAYS);
  const real = dhakaParts(now);
  const days = [];
  const seen = new Set();
  const baselineKey = state?.baselineKey || null;

  for (let i = lookback; i >= 1; i -= 1) {
    const d = addCalendarDays(real, -i);
    if (!isWeekday(d)) continue;
    const key = dateKey(d);
    if (baselineKey && key < baselineKey) continue;
    if (seen.has(key)) continue;
    if (isDayComplete(state, key)) continue;
    seen.add(key);
    days.push({ key, year: d.year, month: d.month, day: d.day, weekday: d.weekday, catchUp: true });
  }

  if (isWeekday(real) && (forceToday || isAtOrAfterSchedule(now))) {
    const key = dateKey(real);
    if (!seen.has(key) && !isDayComplete(state, key)) {
      days.push({
        key,
        year: real.year,
        month: real.month,
        day: real.day,
        weekday: real.weekday,
        catchUp: false,
      });
    }
  }

  return days;
}

function targetDateToJsDate(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 6, 0, 0));
}

module.exports = {
  TIMEZONE,
  EOD_WINDOW_START_MIN,
  EOD_WINDOW_END_MIN,
  SCHEDULE_HOUR,
  SCHEDULE_MINUTE,
  MAX_LOOKBACK_DAYS,
  dhakaParts,
  dateKey,
  parseDateKey,
  mmddyyyy,
  isWeekday,
  addCalendarDays,
  sameDay,
  isInEodMessageWindow,
  isAtOrAfterSchedule,
  listDaysNeedingPost,
  isDayComplete,
  targetDateToJsDate,
};
