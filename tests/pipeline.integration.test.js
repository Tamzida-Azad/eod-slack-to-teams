const path = require('path');
const fs = require('fs');
const os = require('os');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createFileStore, normalizeState } = require('../lib/eod-state');
const { canAttemptNow, runDaily } = require('../lib/run-daily');
const { postToTeams, blocksToAdaptiveCard } = require('../lib/post-teams');
const { assertAuthorized } = require('../lib/api-auth');
const { formatEod } = require('../lib/format-eod');

function memoryStore(initial = { days: {} }) {
  let data = normalizeState(initial);
  return {
    kind: 'memory',
    async load() {
      return JSON.parse(JSON.stringify(data));
    },
    async save(state) {
      data = normalizeState(state);
    },
    snapshot() {
      return data;
    },
  };
}

describe('state file adapter', () => {
  it('round-trips schema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eod-state-'));
    const file = path.join(dir, 'eod-state.json');
    try {
      const store = createFileStore(file);
      const state = {
        baselineKey: '2026-09-01',
        days: { '2026-09-08': { status: 'posted', attempts: 1 } },
      };
      await store.save(state);
      const loaded = await store.load();
      assert.equal(loaded.baselineKey, '2026-09-01');
      assert.equal(loaded.days['2026-09-08'].status, 'posted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('gatekeeper one-shot', () => {
  it('respects retry interval without sleeping', () => {
    const now = new Date('2026-09-10T18:00:00.000Z');
    const state = {
      days: {
        '2026-09-10': {
          status: 'pending',
          attempts: 2,
          lastAttemptAt: new Date(now.getTime() - 60_000).toISOString(),
        },
      },
    };
    const prev = process.env.EOD_RETRY_INTERVAL_MS;
    process.env.EOD_RETRY_INTERVAL_MS = String(10 * 60 * 1000);
    const gate = canAttemptNow(state, '2026-09-10', now);
    if (prev == null) delete process.env.EOD_RETRY_INTERVAL_MS;
    else process.env.EOD_RETRY_INTERVAL_MS = prev;
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'retry_wait');
  });
});

describe('Teams Graph post', () => {
  it('dry-run never calls fetch', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const sample = {
      messages: [{ author: 'A', body: 'EOD\n#1 done - fixed' }],
    };
    const formatted = formatEod(sample, { date: new Date('2026-09-03T17:00:00+06:00') });
    const result = await postToTeams(formatted.payloadText, formatted.payloadHtml, {
      blocks: formatted.blocks,
      dryRun: true,
      fetchImpl,
      accessToken: 'ms-token',
      teamId: 'team',
      channelId: 'channel',
    });
    assert.equal(result.dryRun, true);
    assert.equal(calls, 0);
  });

  it('builds adaptive card from blocks', () => {
    const card = blocksToAdaptiveCard(
      [
        { style: 'bold', text: 'EOD Updates' },
        { style: 'normal', text: '09/03/2026' },
        { style: 'italic', text: 'footer' },
      ],
      'fallback'
    );
    assert.equal(card.type, 'AdaptiveCard');
    assert.ok(card.body.some((b) => String(b.text).includes('EOD')));
  });

  it('empty day path does not post in runDaily dry integration', async () => {
    let webhookCalls = 0;
    const store = memoryStore({
      baselineKey: '2026-09-10',
      days: {},
    });
    const now = new Date('2026-09-10T17:35:00.000Z');
    const result = await runDaily({
      dryRun: true,
      mode: 'once',
      now,
      store,
      writeFiles: false,
      silent: true,
      scrapeSlackEod: async () => ({
        messages: [],
        window: {},
        stats: { messagesKept: 0 },
      }),
      postToTeams: async () => {
        webhookCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(webhookCalls, 0);
    assert.ok(result.results.some((r) => r.key === '2026-09-10'));
  });

  it('posts when messages exist and dryRun false', async () => {
    let webhookCalls = 0;
    const store = memoryStore({
      baselineKey: '2026-09-10',
      days: {},
    });
    const now = new Date('2026-09-10T17:35:00.000Z');
    const result = await runDaily({
      dryRun: false,
      mode: 'once',
      now,
      store,
      writeFiles: false,
      silent: true,
      scrapeSlackEod: async () => ({
        messages: [{ author: 'Tamzida', body: 'EOD\n#100 done - shipped' }],
        stats: { messagesKept: 1 },
      }),
      postToTeams: async () => {
        webhookCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(webhookCalls, 1);
    assert.equal(result.results.find((r) => r.key === '2026-09-10')?.status, 'posted');
    assert.equal(store.snapshot().days['2026-09-10'].status, 'posted');
  });

  it('marks empty and does not post when no updates', async () => {
    let webhookCalls = 0;
    const store = memoryStore({ baselineKey: '2026-09-10', days: {} });
    const now = new Date('2026-09-10T17:35:00.000Z');
    await runDaily({
      dryRun: false,
      mode: 'once',
      now,
      store,
      writeFiles: false,
      silent: true,
      scrapeSlackEod: async () => ({ messages: [], stats: { messagesKept: 0 } }),
      postToTeams: async () => {
        webhookCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(webhookCalls, 0);
    assert.equal(store.snapshot().days['2026-09-10'].status, 'empty');
  });
});

describe('API auth', () => {
  it('rejects when secrets configured and missing', () => {
    const config = require('../lib/config');
    const oldCron = config.secrets.cronSecret;
    const oldRun = config.secrets.runSecret;
    config.secrets.cronSecret = 'cron-test';
    config.secrets.runSecret = 'run-test';
    const result = assertAuthorized({ headers: {} });
    assert.equal(result.ok, false);
    config.secrets.cronSecret = oldCron;
    config.secrets.runSecret = oldRun;
  });

  it('allows bearer run secret', () => {
    const config = require('../lib/config');
    const oldCron = config.secrets.cronSecret;
    const oldRun = config.secrets.runSecret;
    config.secrets.cronSecret = 'cron-test';
    config.secrets.runSecret = 'run-test';
    const result = assertAuthorized({
      headers: { authorization: 'Bearer run-test' },
    });
    assert.equal(result.ok, true);
    config.secrets.cronSecret = oldCron;
    config.secrets.runSecret = oldRun;
  });
});
