/**
 * Slack user OAuth (xoxp) — app is only an OAuth client, actions run as the user.
 */
const crypto = require('crypto');
const config = require('./config');
const { setProvider, loadTokens, markExpired } = require('./token-store');

const AUTH_ERRORS = new Set([
  'invalid_auth',
  'token_expired',
  'token_revoked',
  'not_authed',
  'account_inactive',
  'invalid_token',
]);

function buildAuthorizeUrl(state) {
  if (!config.slack.clientId) {
    throw new Error('Missing SLACK_CLIENT_ID');
  }
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', config.slack.clientId);
  url.searchParams.set('user_scope', config.slack.userScopes.join(','));
  url.searchParams.set('redirect_uri', config.slack.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

function createOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}

async function exchangeCode(code, fetchImpl = fetch) {
  if (!config.slack.clientId || !config.slack.clientSecret) {
    throw new Error('Missing SLACK_CLIENT_ID / SLACK_CLIENT_SECRET');
  }
  const body = new URLSearchParams({
    client_id: config.slack.clientId,
    client_secret: config.slack.clientSecret,
    code,
    redirect_uri: config.slack.redirectUri,
  });
  const res = await fetchImpl('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack oauth.v2.access failed: ${data.error || res.status}`);
  }
  const authed = data.authed_user || {};
  if (!authed.access_token) {
    throw new Error('Slack OAuth did not return a user access_token (check user_scope)');
  }
  const expiresAt =
    authed.expires_in != null
      ? new Date(Date.now() + Number(authed.expires_in) * 1000).toISOString()
      : null;

  return {
    access_token: authed.access_token,
    refresh_token: authed.refresh_token || null,
    token_type: authed.token_type || 'user',
    scope: authed.scope || config.slack.userScopes.join(','),
    user_id: authed.id || null,
    team_id: data.team?.id || null,
    team_label: data.team?.name || null,
    user_label: authed.id || null,
    expires_at: expiresAt,
    status: 'connected',
    connected_at: new Date().toISOString(),
  };
}

async function saveSlackTokens(record) {
  // Enrich user label via auth.test if possible
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${record.access_token}` },
    });
    const data = await res.json();
    if (data.ok) {
      record.user_label = data.user || record.user_label;
      record.team_label = data.team || record.team_label;
      record.team_id = data.team_id || record.team_id;
      record.user_id = data.user_id || record.user_id;
    }
  } catch {
    // ignore
  }
  await setProvider('slack', record);
  return record;
}

async function getValidSlackAccessToken(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const store = options.tokens || (await loadTokens());
  const slack = store.slack;
  if (!slack?.access_token) {
    const err = new Error('Slack not connected — open /integrations/slack to authenticate');
    err.code = 'slack_missing';
    throw err;
  }
  if (slack.status === 'expired') {
    const err = new Error('Slack token expired — reconnect at /integrations/slack');
    err.code = 'slack_expired';
    throw err;
  }
  if (slack.expires_at && new Date(slack.expires_at).getTime() <= Date.now()) {
    // Try refresh if available (token rotation)
    if (slack.refresh_token && config.slack.clientId) {
      try {
        const refreshed = await refreshSlackToken(slack.refresh_token, fetchImpl);
        await saveSlackTokens({ ...slack, ...refreshed, status: 'connected' });
        return refreshed.access_token;
      } catch (e) {
        await markExpired('slack', e.message);
        const err = new Error('Slack token expired — reconnect at /integrations/slack');
        err.code = 'slack_expired';
        throw err;
      }
    }
    await markExpired('slack', 'expires_at passed');
    const err = new Error('Slack token expired — reconnect at /integrations/slack');
    err.code = 'slack_expired';
    throw err;
  }
  return slack.access_token;
}

async function refreshSlackToken(refreshToken, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: config.slack.clientId,
    client_secret: config.slack.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetchImpl('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'refresh failed');
  const authed = data.authed_user || data;
  return {
    access_token: authed.access_token || data.access_token,
    refresh_token: authed.refresh_token || data.refresh_token || refreshToken,
    expires_at:
      (authed.expires_in || data.expires_in) != null
        ? new Date(Date.now() + Number(authed.expires_in || data.expires_in) * 1000).toISOString()
        : null,
  };
}

function isSlackAuthError(errorCode) {
  return AUTH_ERRORS.has(String(errorCode || ''));
}

module.exports = {
  buildAuthorizeUrl,
  createOAuthState,
  exchangeCode,
  saveSlackTokens,
  getValidSlackAccessToken,
  refreshSlackToken,
  isSlackAuthError,
  AUTH_ERRORS,
};
