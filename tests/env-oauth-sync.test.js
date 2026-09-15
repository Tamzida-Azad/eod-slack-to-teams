const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('env-file oauth sync', () => {
  let dir;
  let envFile;
  let prevDotenv;
  let prevKey;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eod-env-'));
    envFile = path.join(dir, '.env');
    fs.writeFileSync(
      envFile,
      'SLACK_CLIENT_ID=keep-me\nTOKEN_ENCRYPTION_KEY=test-encryption-key-please-change-me-32\n',
      'utf8'
    );
    prevDotenv = process.env.DOTENV_PATH;
    prevKey = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.DOTENV_PATH = envFile;
    process.env.STATE_BACKEND = 'file';
    process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-please-change-me-32';
    process.env.OAUTH_TOKENS_FILE = path.join(dir, 'tokens.enc');
    // Clear token env
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('SLACK_USER_') || k.startsWith('SLACK_TOKEN_') || k.startsWith('SLACK_TEAM_')) {
        if (k !== 'SLACK_TEAM_ID' || true) delete process.env[k];
      }
      if (k.startsWith('TEAMS_USER_') || k.startsWith('TEAMS_TOKEN_')) delete process.env[k];
    }
  });

  after(() => {
    process.env.DOTENV_PATH = prevDotenv;
    process.env.TOKEN_ENCRYPTION_KEY = prevKey;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes slack tokens into .env after setProvider', async () => {
    // Re-require modules so they see DOTENV_PATH — use fresh requires via path
    delete require.cache[require.resolve('../lib/env-file')];
    delete require.cache[require.resolve('../lib/token-store')];
    delete require.cache[require.resolve('../lib/load-env')];
    const { setProvider, loadTokens, getIntegrationsStatus } = require('../lib/token-store');

    await setProvider('slack', {
      access_token: 'xoxp-from-oauth',
      refresh_token: 'refresh-1',
      user_label: 'Tamzida',
      team_label: 'SJ',
      team_id: 'T1',
      user_id: 'U1',
      status: 'connected',
      scope: 'channels:history',
    });

    const text = fs.readFileSync(envFile, 'utf8');
    assert.match(text, /SLACK_CLIENT_ID=keep-me/);
    assert.match(text, /SLACK_USER_ACCESS_TOKEN=xoxp-from-oauth/);
    assert.match(text, /SLACK_TOKEN_STATUS=connected/);
    assert.equal(process.env.SLACK_USER_ACCESS_TOKEN, 'xoxp-from-oauth');

    // Clear process memory and reload from env file
    delete process.env.SLACK_USER_ACCESS_TOKEN;
    const { loadDotEnv } = require('../lib/env-file');
    loadDotEnv({ path: envFile, override: true });
    const loaded = await loadTokens();
    assert.equal(loaded.slack.access_token, 'xoxp-from-oauth');

    const status = await getIntegrationsStatus();
    assert.equal(status.slack.status, 'connected');
    assert.ok(!JSON.stringify(status).includes('xoxp-from-oauth'));
  });

  it('clears teams env on clearProvider', async () => {
    delete require.cache[require.resolve('../lib/token-store')];
    const { setProvider, clearProvider } = require('../lib/token-store');
    await setProvider('teams', {
      access_token: 'ms-token',
      user_label: 'User',
      status: 'connected',
    });
    await clearProvider('teams');
    const text = fs.readFileSync(envFile, 'utf8');
    assert.match(text, /TEAMS_USER_ACCESS_TOKEN=""/);
    assert.equal(process.env.TEAMS_USER_ACCESS_TOKEN, '');
  });
});
