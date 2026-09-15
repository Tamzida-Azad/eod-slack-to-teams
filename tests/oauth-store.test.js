const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encryptJson, decryptJson } = require('../lib/crypto-secrets');
const {
  saveTokens,
  loadTokens,
  providerStatus,
  getIntegrationsStatus,
  markExpired,
  setProvider,
} = require('../lib/token-store');

describe('crypto-secrets', () => {
  it('round-trips JSON', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-please-change-me-32';
    const payload = { hello: 'world', n: 1 };
    const packed = encryptJson(payload);
    assert.ok(packed.includes('.'));
    assert.deepEqual(decryptJson(packed), payload);
  });
});

describe('token-store', () => {
  let prevFile;
  let prevKey;
  let dir;

  before(() => {
    prevKey = process.env.TOKEN_ENCRYPTION_KEY;
    prevFile = process.env.OAUTH_TOKENS_FILE;
    process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-please-change-me-32';
    process.env.STATE_BACKEND = 'file';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eod-oauth-'));
    process.env.OAUTH_TOKENS_FILE = path.join(dir, 'tokens.enc');
  });

  after(() => {
    process.env.TOKEN_ENCRYPTION_KEY = prevKey;
    process.env.OAUTH_TOKENS_FILE = prevFile;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('saves and loads slack/teams without exposing in status', async () => {
    await saveTokens({
      slack: {
        access_token: 'xoxp-secret',
        user_label: 'Tamzida',
        team_label: 'SJ',
        status: 'connected',
      },
      teams: {
        access_token: 'ms-secret',
        user_label: 'Tamzida M',
        status: 'connected',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const loaded = await loadTokens();
    assert.equal(loaded.slack.access_token, 'xoxp-secret');
    const status = await getIntegrationsStatus();
    assert.equal(status.slack.status, 'connected');
    assert.equal(status.slack.user, 'Tamzida');
    assert.ok(!JSON.stringify(status).includes('xoxp-secret'));
    assert.ok(!JSON.stringify(status).includes('ms-secret'));
  });

  it('marks expired status', async () => {
    await setProvider('slack', {
      access_token: 'xoxp-old',
      user_label: 'U',
      status: 'connected',
    });
    await markExpired('slack', 'invalid_auth');
    const st = providerStatus((await loadTokens()).slack);
    assert.equal(st.status, 'expired');
    assert.equal(st.expired, true);
  });

  it('detects expires_at in the past', () => {
    const st = providerStatus({
      access_token: 'x',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(st.status, 'expired');
  });
});
