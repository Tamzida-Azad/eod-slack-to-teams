const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scrapeSlackEod } = require('../lib/scrape-slack');
const { preferEodLikeMessages } = require('../lib/message-window');

describe('Slack API scrape mapping', () => {
  it('preferEodLike keeps EOD-ish messages', () => {
    const msgs = [
      { author: 'A', body: 'lunch?' },
      { author: 'B', body: 'EOD\n#1 done' },
    ];
    const filtered = preferEodLikeMessages(msgs);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].author, 'B');
  });

  it('maps conversations.history into format-ready messages', async () => {
    const ts = String(Date.UTC(2026, 8, 8, 13, 58, 0) / 1000);
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('conversations.history')) {
        return {
          json: async () => ({
            ok: true,
            messages: [
              { user: 'U1', text: 'EOD\n#99 shipped - done', ts, type: 'message' },
              { user: 'U2', text: 'zoom link https://zoom.us/j/1', ts, type: 'message' },
            ],
            response_metadata: {},
          }),
        };
      }
      if (u.includes('users.info')) {
        return {
          json: async () => ({
            ok: true,
            user: { profile: { display_name: 'Test User' }, real_name: 'Test User' },
          }),
        };
      }
      return { json: async () => ({ ok: false, error: 'unknown' }) };
    };

    const prev = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    const payload = await scrapeSlackEod({
      targetDate: { year: 2026, month: 9, day: 8 },
      now: new Date('2026-09-09T05:00:00.000Z'),
      fetchImpl,
      writeFiles: false,
      accessToken: 'xoxp-test-user-token',
    });
    if (prev == null) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = prev;

    assert.ok(payload.messages.length >= 1);
    assert.equal(payload.messages[0].author, 'Test User');
    assert.match(payload.messages[0].body, /EOD|#99/);
  });
});
