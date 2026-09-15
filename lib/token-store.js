/**
 * OAuth token store — primary: .env / process.env; mirror: encrypted secrets/tokens.enc + KV.
 */
const fs = require('fs');
const path = require('path');
require('./load-env');
const config = require('./config');
const {
  recordFromEnv,
  syncProviderToEnv,
  clearProviderEnv,
} = require('./env-file');

const KV_OAUTH_KEY = 'oauth-tokens';
const DEFAULT_STORE = { slack: null, teams: null, updatedAt: null };

function tokensFilePath() {
  return (
    process.env.OAUTH_TOKENS_FILE ||
    path.join(config.rootDir, 'secrets', 'tokens.enc')
  );
}

function useCloud() {
  if (process.env.STATE_BACKEND === 'file') return false;
  return Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
}

function canEncrypt() {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY && String(process.env.TOKEN_ENCRYPTION_KEY).length >= 16);
}

async function readCiphertext() {
  if (!canEncrypt()) return null;
  if (useCloud()) {
    try {
      const { kv } = require('./kv-rest');
      const raw = await kv.get(KV_OAUTH_KEY);
      if (typeof raw === 'string' && raw.includes('.')) return raw;
      if (raw && typeof raw === 'object' && raw.ciphertext) return raw.ciphertext;
    } catch (e) {
      if (process.env.NODE_ENV === 'production' && useCloud()) {
        // fall through to file
      }
    }
  }
  const file = tokensFilePath();
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim();
}

async function writeCiphertext(ciphertext) {
  if (!canEncrypt()) return;
  const { encryptJson } = require('./crypto-secrets');
  // ciphertext already encrypted by caller
  const file = tokensFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ciphertext, 'utf8');
  } catch {
    // read-only FS
  }
  if (useCloud()) {
    const { kv } = require('./kv-rest');
    await kv.set(KV_OAUTH_KEY, ciphertext);
  }
}

function emptyStore() {
  return { ...DEFAULT_STORE, slack: null, teams: null };
}

async function loadEncryptedStore() {
  if (!canEncrypt()) return emptyStore();
  const packed = await readCiphertext();
  if (!packed) return emptyStore();
  try {
    const { decryptJson } = require('./crypto-secrets');
    const data = decryptJson(packed);
    return {
      slack: data.slack || null,
      teams: data.teams || null,
      updatedAt: data.updatedAt || null,
    };
  } catch {
    return emptyStore();
  }
}

/**
 * Prefer env tokens; fill gaps from encrypted mirror.
 */
async function loadTokens() {
  const enc = await loadEncryptedStore();
  const slackEnv = recordFromEnv('slack');
  const teamsEnv = recordFromEnv('teams');
  return {
    slack: slackEnv || enc.slack || null,
    teams: teamsEnv || enc.teams || null,
    updatedAt: enc.updatedAt || null,
  };
}

async function saveTokens(store) {
  const payload = {
    slack: store.slack || null,
    teams: store.teams || null,
    updatedAt: new Date().toISOString(),
  };

  // Always sync to .env + process.env (source of truth for local / readable secrets)
  syncProviderToEnv('slack', payload.slack);
  syncProviderToEnv('teams', payload.teams);

  if (canEncrypt()) {
    const { encryptJson } = require('./crypto-secrets');
    const ciphertext = encryptJson(payload);
    await writeCiphertext(ciphertext);
  }

  return payload;
}

async function setProvider(provider, record) {
  const store = await loadTokens();
  store[provider] = record;
  // Sync this provider to env immediately
  syncProviderToEnv(provider, record);
  return saveTokens(store);
}

async function clearProvider(provider) {
  clearProviderEnv(provider);
  const store = await loadTokens();
  store[provider] = null;
  return saveTokens(store);
}

function providerStatus(record, now = new Date()) {
  if (!record || (!record.access_token && record.status !== 'expired')) {
    return {
      status: 'missing',
      connected: false,
      expired: false,
      expiresAt: null,
      user: null,
      team: null,
    };
  }
  const expiresAt = record.expires_at || null;
  const expired =
    record.status === 'expired' ||
    (expiresAt && new Date(expiresAt).getTime() <= now.getTime());
  if (expired) {
    return {
      status: 'expired',
      connected: false,
      expired: true,
      expiresAt,
      user: record.user_label || record.user_id || null,
      team: record.team_label || record.team_id || null,
    };
  }
  if (!record.access_token) {
    return {
      status: 'missing',
      connected: false,
      expired: false,
      expiresAt: null,
      user: null,
      team: null,
    };
  }
  return {
    status: 'connected',
    connected: true,
    expired: false,
    expiresAt,
    user: record.user_label || record.user_id || null,
    team: record.team_label || record.team_id || null,
  };
}

async function getIntegrationsStatus(now = new Date()) {
  try {
    const store = await loadTokens();
    return {
      ok: true,
      updatedAt: store.updatedAt,
      source: {
        slack: store.slack?.source || (store.slack ? 'store' : null),
        teams: store.teams?.source || (store.teams ? 'store' : null),
      },
      slack: providerStatus(store.slack, now),
      teams: providerStatus(store.teams, now),
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      slack: { status: 'error', connected: false, expired: false },
      teams: { status: 'error', connected: false, expired: false },
    };
  }
}

async function markExpired(provider, reason) {
  const store = await loadTokens();
  const next = store[provider]
    ? {
        ...store[provider],
        status: 'expired',
        error: reason || 'expired',
        expired_at: new Date().toISOString(),
      }
    : {
        access_token: '',
        status: 'expired',
        error: reason || 'expired',
        expired_at: new Date().toISOString(),
      };
  store[provider] = next;
  syncProviderToEnv(provider, next);
  await saveTokens(store);
  return next;
}

module.exports = {
  KV_OAUTH_KEY,
  tokensFilePath,
  loadTokens,
  saveTokens,
  setProvider,
  clearProvider,
  providerStatus,
  getIntegrationsStatus,
  markExpired,
  emptyStore,
  canEncrypt,
};
