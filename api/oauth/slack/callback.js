const {
  exchangeCode,
  saveSlackTokens,
} = require('../../../lib/oauth-slack');
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
      redirect(res, `${base}/integrations/slack?error=${encodeURIComponent(q.error)}`);
      return;
    }
    if (!q.code || !q.state) {
      redirect(res, `${base}/integrations/slack?error=missing_code`);
      return;
    }
    if (!takeState(`slack:${q.state}`)) {
      redirect(res, `${base}/integrations/slack?error=invalid_state`);
      return;
    }
    const record = await exchangeCode(q.code);
    await saveSlackTokens(record);
    redirect(res, `${base}/integrations/slack?ok=1`);
  } catch (e) {
    redirect(
      res,
      `${base}/integrations/slack?error=${encodeURIComponent(e.message || 'oauth_failed')}`
    );
  }
};
