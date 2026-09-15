const {
  exchangeCode,
  saveTeamsTokens,
} = require('../../../lib/oauth-teams');
const { takeState, getQuery, redirect, json } = require('../../../lib/oauth-http');
const { publicBaseUrl } = require('../../../lib/config-base-url');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  const q = getQuery(req);
  const base = publicBaseUrl();
  try {
    if (q.error) {
      redirect(
        res,
        `${base}/integrations/teams?error=${encodeURIComponent(q.error_description || q.error)}`
      );
      return;
    }
    if (!q.code || !q.state) {
      redirect(res, `${base}/integrations/teams?error=missing_code`);
      return;
    }
    if (!takeState(`teams:${q.state}`)) {
      redirect(res, `${base}/integrations/teams?error=invalid_state`);
      return;
    }
    const record = await exchangeCode(q.code);
    await saveTeamsTokens(record);
    redirect(res, `${base}/integrations/teams?ok=1`);
  } catch (e) {
    redirect(
      res,
      `${base}/integrations/teams?error=${encodeURIComponent(e.message || 'oauth_failed')}`
    );
  }
};
