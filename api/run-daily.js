const { runDaily } = require('../lib/run-daily');
const { assertAuthorized, readJsonBody } = require('../lib/api-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-run-secret');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  const auth = assertAuthorized(req);
  if (!auth.ok) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: auth.error }));
    return;
  }

  try {
    let body = {};
    if (req.method === 'POST') {
      body = await readJsonBody(req);
    }

    const dryRun =
      body.dryRun === true ||
      req.query?.dryRun === '1' ||
      process.env.EOD_DRY_RUN === '1';

    const forceToday = body.forceToday === true || req.query?.forceToday === '1';
    if (forceToday) process.env.EOD_FORCE_TODAY = '1';

    const result = await runDaily({
      dryRun,
      mode: 'once',
      writeFiles: false,
      silent: true,
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: result.ok,
        via: auth.via,
        dryRun,
        message: result.message || null,
        results: result.results,
        lastRun: result.state?.lastRun || null,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  }
};
