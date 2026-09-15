const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isInEodMessageWindow,
  listDaysNeedingPost,
  mmddyyyy,
} = require('../lib/eod-calendar');
const {
  parseSlackTimestamp,
  isTargetDayMessage,
  normalizeDayContext,
  getDateWindow,
} = require('../lib/message-window');

describe('EOD window + catch-up (golden filter rules)', () => {
  it('window boundaries', () => {
    assert.equal(isInEodMessageWindow(12, 0), true);
    assert.equal(isInEodMessageWindow(11, 59), false);
    assert.equal(isInEodMessageWindow(23, 20), true);
    assert.equal(isInEodMessageWindow(23, 21), false);
    assert.equal(isInEodMessageWindow(19, 58), true);
  });

  it('target-day message filters', () => {
    const nowTueNight = new Date('2026-09-08T17:30:00.000Z');
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

    assert.equal(isTargetDayMessage(msg('7:58 PM', 'Today', winSep8.realToday), winSep8), true);
    assert.equal(isTargetDayMessage(msg('10:00 AM', 'Today', winSep8.realToday), winSep8), false);
    assert.equal(
      isTargetDayMessage(msg('Today at 9:26 PM', null, winSep8.realToday), winSep8),
      true
    );
    assert.equal(isTargetDayMessage(msg('11:30 PM', 'Today', winSep8.realToday), winSep8), false);

    const nowSep10 = new Date('2026-09-10T05:00:00.000Z');
    const winCatch8 = getDateWindow({ year: 2026, month: 9, day: 8 }, nowSep10);
    assert.equal(
      isTargetDayMessage(msg('7:58 PM', 'Monday, September 8th', winCatch8.realToday), winCatch8),
      true
    );
    assert.equal(
      isTargetDayMessage(msg('8:19 PM', 'Yesterday', winCatch8.realToday), winCatch8),
      false
    );

    const winCatch9 = getDateWindow({ year: 2026, month: 9, day: 9 }, nowSep10);
    assert.equal(
      isTargetDayMessage(msg('8:19 PM', 'Yesterday', winCatch9.realToday), winCatch9),
      true
    );
  });

  it('listDaysNeedingPost catch-up + schedule', () => {
    const nowSep10 = new Date('2026-09-10T05:00:00.000Z');
    const needing = listDaysNeedingPost({ baselineKey: '2026-09-07', days: {} }, nowSep10);
    const keys = needing.map((d) => d.key);
    assert.ok(keys.includes('2026-09-08'));
    assert.ok(keys.includes('2026-09-09'));
    assert.ok(!keys.includes('2026-09-10'));
    assert.equal(mmddyyyy({ year: 2026, month: 9, day: 8 }), '09/08/2026');

    const afterSchedule = new Date('2026-09-10T17:35:00.000Z');
    const needingNight = listDaysNeedingPost(
      {
        baselineKey: '2026-09-10',
        days: {
          '2026-09-08': { status: 'posted' },
          '2026-09-09': { status: 'posted' },
        },
      },
      afterSchedule
    );
    assert.ok(needingNight.some((d) => d.key === '2026-09-10' && d.catchUp === false));
  });
});
