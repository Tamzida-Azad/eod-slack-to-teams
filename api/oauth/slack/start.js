const { buildAuthorizeUrl, createOAuthState } = require('../../../lib/oauth-slack');
const { putState, redirect, json } = require('../../../lib/oauth-http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const state = createOAuthState();
    putState(`slack:${state}`, true);
    const url = buildAuthorizeUrl(state);
    redirect(res, url);
  } catch (e) {
    json(res, 500, { ok: false, error: e.message || String(e) });
  }
};
