/**
 * Unit checks: EOD window, target-day filter, backfill day list (no browser).
 */
const {
  parseSlackTimestamp,
  isTargetDayMessage,
  normalizeDayContext,
  getDateWindow,
} = require('./scrape-slack-eod');
const {
  isInEodMessageWindow,
  listDaysNeedingPost,
  dateKey,
  mmddyyyy,
} = require('./eod-calendar');

let failed = 0;
function assert(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

// --- window ---
assert('12:00 in window', isInEodMessageWindow(12, 0) === true);
assert('11:59 AM out of window', isInEodMessageWindow(11, 59) === false);
assert('11:20 PM in window', isInEodMessageWindow(23, 20) === true);
assert('11:21 PM out of window', isInEodMessageWindow(23, 21) === false);
assert('7:58 PM in window', isInEodMessageWindow(19, 58) === true);

// --- target day Sep 8 while real today is Sep 9 ---
const nowTueNight = new Date('2026-09-08T17:30:00.000Z'); // still Sep 8 23:30 Dhaka
const winSep8 = getDateWindow({ year: 2026, month: 9, day: 8 }, nowTueNight);

function msg(timestamp, dayContextRaw, realToday) {
  const parsedTimestamp = parseSlackTimestamp(timestamp, realToday);
  return {
    author: 'Test',
    timestamp,
    parsedTimestamp,
    dayContext: normalizeDayContext(dayContextRaw),
    body: 'EOD: #1234 done',
  };
}

assert(
  'bare 7:58 PM under Today on target=today kept',
  isTargetDayMessage(msg('7:58 PM', 'Today', winSep8.realToday), winSep8) === true
);
assert(
  '10:00 AM under Today rejected (before 12PM)',
  isTargetDayMessage(msg('10:00 AM', 'Today', winSep8.realToday), winSep8) === false
);
assert(
  'Today at 9:26 PM kept',
  isTargetDayMessage(msg('Today at 9:26 PM', null, winSep8.realToday), winSep8) === true
);
assert(
  '11:30 PM rejected (after 11:20)',
  isTargetDayMessage(msg('11:30 PM', 'Today', winSep8.realToday), winSep8) === false
);

// Catch-up: real day Sep 10, target Sep 8
const nowSep10 = new Date('2026-09-10T05:00:00.000Z'); // 11:00 Dhaka Sep 10
const winCatch8 = getDateWindow({ year: 2026, month: 9, day: 8 }, nowSep10);
assert(
  'Sep 8 divider + 7:58 PM kept for catch-up target 8th',
  isTargetDayMessage(
    msg('7:58 PM', 'Monday, September 8th', winCatch8.realToday),
    winCatch8
  ) === true
);
assert(
  'Yesterday divider on Sep 10 = Sep 9, not kept for target 8th',
  isTargetDayMessage(msg('8:19 PM', 'Yesterday', winCatch8.realToday), winCatch8) === false
);

const winCatch9 = getDateWindow({ year: 2026, month: 9, day: 9 }, nowSep10);
assert(
  'Yesterday = Sep 9 kept for target 9th',
  isTargetDayMessage(msg('8:19 PM', 'Yesterday', winCatch9.realToday), winCatch9) === true
);

// --- backfill list ---
const state = {
  baselineKey: '2026-09-07',
  days: {},
};
const needing = listDaysNeedingPost(state, nowSep10);
const keys = needing.map((d) => d.key);
assert('catch-up includes 2026-09-08', keys.includes('2026-09-08'));
assert('catch-up includes 2026-09-09', keys.includes('2026-09-09'));
assert('before 11:30 does not include 2026-09-10', !keys.includes('2026-09-10'));
assert('mmddyyyy 8th', mmddyyyy({ year: 2026, month: 9, day: 8 }) === '09/08/2026');

const afterSchedule = new Date('2026-09-10T17:35:00.000Z'); // 23:35 Dhaka
const needingNight = listDaysNeedingPost(
  { baselineKey: '2026-09-10', days: { '2026-09-08': { status: 'posted' }, '2026-09-09': { status: 'posted' } } },
  afterSchedule
);
assert(
  'at 11:30 includes today 10th',
  needingNight.some((d) => d.key === '2026-09-10' && d.catchUp === false)
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll gatekeeper/window checks passed');
