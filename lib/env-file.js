/**
 * Load + upsert keys in project .env (gitignored).
 * After OAuth, token fields are written here and applied to process.env.
 */
const fs = require('fs');
const path = require('path');

function envPath() {
  return process.env.DOTENV_PATH || path.resolve(__dirname, '..', '.env');
}

function parseEnvText(text) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map.set(key, val);
  }
  return map;
}

function escapeEnvValue(value) {
  const s = value == null ? '' : String(value);
  if (/[\s#"'$\\]/.test(s) || s === '') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Load .env into process.env without overriding existing non-empty env.
 */
function loadDotEnv(options = {}) {
  const file = options.path || envPath();
  if (!fs.existsSync(file)) return { loaded: false, path: file };
  const text = fs.readFileSync(file, 'utf8');
  const map = parseEnvText(text);
  for (const [k, v] of map.entries()) {
    if (options.override || process.env[k] == null || process.env[k] === '') {
      process.env[k] = v;
    }
  }
  return { loaded: true, path: file, keys: [...map.keys()] };
}

/**
 * Upsert keys in .env and process.env. Preserves unrelated lines/comments.
 * @param {Record<string, string|null|undefined>} updates — null/undefined clears to empty
 */
function upsertEnvVars(updates, options = {}) {
  const file = options.path || envPath();
  let text = '';
  if (fs.existsSync(file)) {
    text = fs.readFileSync(file, 'utf8');
  }

  const keys = Object.keys(updates);
  const seen = new Set();
  const lines = text ? text.split(/\r?\n/) : [];
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      const raw = updates[key];
      const val = raw == null ? '' : String(raw);
      out.push(`${key}=${escapeEnvValue(val)}`);
      process.env[key] = val;
      seen.add(key);
    } else {
      out.push(line);
    }
  }

  const missing = keys.filter((k) => !seen.has(k));
  if (missing.length) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push('# --- OAuth tokens (auto-updated; do not commit) ---');
    for (const key of missing) {
      const raw = updates[key];
      const val = raw == null ? '' : String(raw);
      out.push(`${key}=${escapeEnvValue(val)}`);
      process.env[key] = val;
    }
  }

  const next = `${out.join('\n').replace(/\n+$/, '')}\n`;
  try {
    fs.writeFileSync(file, next, 'utf8');
    return { ok: true, path: file, updated: keys };
  } catch (e) {
    // Vercel / read-only FS: still applied to process.env
    return { ok: false, path: file, updated: keys, error: e.message, processEnvOnly: true };
  }
}

const SLACK_ENV_KEYS = {
  access_token: 'SLACK_USER_ACCESS_TOKEN',
  refresh_token: 'SLACK_USER_REFRESH_TOKEN',
  user_id: 'SLACK_USER_ID',
  user_label: 'SLACK_USER_LABEL',
  team_id: 'SLACK_TEAM_ID',
  team_label: 'SLACK_TEAM_LABEL',
  expires_at: 'SLACK_TOKEN_EXPIRES_AT',
  status: 'SLACK_TOKEN_STATUS',
  scope: 'SLACK_TOKEN_SCOPE',
  error: 'SLACK_TOKEN_ERROR',
};

const TEAMS_ENV_KEYS = {
  access_token: 'TEAMS_USER_ACCESS_TOKEN',
  refresh_token: 'TEAMS_USER_REFRESH_TOKEN',
  user_id: 'TEAMS_USER_ID',
  user_label: 'TEAMS_USER_LABEL',
  expires_at: 'TEAMS_TOKEN_EXPIRES_AT',
  status: 'TEAMS_TOKEN_STATUS',
  scope: 'TEAMS_TOKEN_SCOPE',
  error: 'TEAMS_TOKEN_ERROR',
};

function recordFromEnv(provider) {
  const keys = provider === 'slack' ? SLACK_ENV_KEYS : TEAMS_ENV_KEYS;
  const access = process.env[keys.access_token] || '';
  const status = process.env[keys.status] || (access ? 'connected' : '');
  if (!access && status !== 'expired') return null;
  return {
    access_token: access,
    refresh_token: process.env[keys.refresh_token] || null,
    user_id: process.env[keys.user_id] || null,
    user_label: process.env[keys.user_label] || null,
    team_id: provider === 'slack' ? process.env[keys.team_id] || null : null,
    team_label: provider === 'slack' ? process.env[keys.team_label] || null : null,
    expires_at: process.env[keys.expires_at] || null,
    status: status || 'connected',
    scope: process.env[keys.scope] || null,
    error: process.env[keys.error] || null,
    source: 'env',
  };
}

function envUpdatesFromRecord(provider, record) {
  const keys = provider === 'slack' ? SLACK_ENV_KEYS : TEAMS_ENV_KEYS;
  const updates = {};
  if (!record) {
    for (const envKey of Object.values(keys)) updates[envKey] = '';
    updates[keys.status] = 'missing';
    return updates;
  }
  updates[keys.access_token] = record.access_token || '';
  updates[keys.refresh_token] = record.refresh_token || '';
  updates[keys.user_id] = record.user_id || '';
  updates[keys.user_label] = record.user_label || '';
  updates[keys.expires_at] = record.expires_at || '';
  updates[keys.status] = record.status || (record.access_token ? 'connected' : 'missing');
  updates[keys.scope] = record.scope || '';
  updates[keys.error] = record.error || '';
  if (provider === 'slack') {
    updates[keys.team_id] = record.team_id || '';
    updates[keys.team_label] = record.team_label || '';
  }
  return updates;
}

function syncProviderToEnv(provider, record) {
  return upsertEnvVars(envUpdatesFromRecord(provider, record));
}

function clearProviderEnv(provider) {
  return syncProviderToEnv(provider, null);
}

module.exports = {
  envPath,
  loadDotEnv,
  upsertEnvVars,
  parseEnvText,
  recordFromEnv,
  envUpdatesFromRecord,
  syncProviderToEnv,
  clearProviderEnv,
  SLACK_ENV_KEYS,
  TEAMS_ENV_KEYS,
};
