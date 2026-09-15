/**
 * Microsoft user OAuth → Graph API for Teams channel messages.
 */
const crypto = require('crypto');
const config = require('./config');
const { setProvider, loadTokens, markExpired } = require('./token-store');

function tenantBase() {
  const tenant = config.teams.tenantId || 'common';
  return `https://login.microsoftonline.com/${tenant}`;
}

function buildAuthorizeUrl(state) {
  if (!config.teams.clientId) {
    throw new Error('Missing AZURE_CLIENT_ID');
  }
  const url = new URL(`${tenantBase()}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', config.teams.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.teams.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', config.teams.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

function createOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}

async function exchangeCode(code, fetchImpl = fetch) {
  if (!config.teams.clientId || !config.teams.clientSecret) {
    throw new Error('Missing AZURE_CLIENT_ID / AZURE_CLIENT_SECRET');
  }
  const body = new URLSearchParams({
    client_id: config.teams.clientId,
    client_secret: config.teams.clientSecret,
    code,
    redirect_uri: config.teams.redirectUri,
    grant_type: 'authorization_code',
    scope: config.teams.scopes.join(' '),
  });
  const res = await fetchImpl(`${tenantBase()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Teams token exchange failed: ${data.error_description || data.error || res.status}`
    );
  }
  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : null;

  let userLabel = null;
  let userId = null;
  try {
    const meRes = await fetchImpl('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const me = await meRes.json();
    userLabel = me.displayName || me.userPrincipalName || null;
    userId = me.id || null;
  } catch {
    // ignore
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    token_type: data.token_type || 'Bearer',
    scope: data.scope || config.teams.scopes.join(' '),
    expires_at: expiresAt,
    user_id: userId,
    user_label: userLabel,
    status: 'connected',
    connected_at: new Date().toISOString(),
  };
}

async function saveTeamsTokens(record) {
  await setProvider('teams', record);
  return record;
}

async function refreshTeamsToken(refreshToken, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: config.teams.clientId,
    client_secret: config.teams.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: config.teams.scopes.join(' '),
  });
  const res = await fetchImpl(`${tenantBase()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Teams refresh failed');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null,
    scope: data.scope,
  };
}

async function getValidTeamsAccessToken(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const store = options.tokens || (await loadTokens());
  const teams = store.teams;
  if (!teams?.access_token) {
    const err = new Error('Teams not connected — open /integrations/teams to authenticate');
    err.code = 'teams_missing';
    throw err;
  }
  if (teams.status === 'expired') {
    const err = new Error('Teams token expired — reconnect at /integrations/teams');
    err.code = 'teams_expired';
    throw err;
  }

  const skewMs = 60_000;
  const needsRefresh =
    teams.expires_at && new Date(teams.expires_at).getTime() <= Date.now() + skewMs;

  if (needsRefresh) {
    if (!teams.refresh_token) {
      await markExpired('teams', 'expires_at passed, no refresh_token');
      const err = new Error('Teams token expired — reconnect at /integrations/teams');
      err.code = 'teams_expired';
      throw err;
    }
    try {
      const refreshed = await refreshTeamsToken(teams.refresh_token, fetchImpl);
      const next = { ...teams, ...refreshed, status: 'connected' };
      await saveTeamsTokens(next);
      return next.access_token;
    } catch (e) {
      await markExpired('teams', e.message);
      const err = new Error('Teams token expired — reconnect at /integrations/teams');
      err.code = 'teams_expired';
      throw err;
    }
  }

  return teams.access_token;
}

function isTeamsAuthError(status, bodyText) {
  if (status === 401 || status === 403) return true;
  const t = String(bodyText || '').toLowerCase();
  return t.includes('invalid_grant') || t.includes('lifetime validation') || t.includes('expired');
}

module.exports = {
  buildAuthorizeUrl,
  createOAuthState,
  exchangeCode,
  saveTeamsTokens,
  getValidTeamsAccessToken,
  refreshTeamsToken,
  isTeamsAuthError,
  tenantBase,
};
