/**
 * Auth helpers for /api routes.
 */
const config = require('./config');

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function getRunSecret(req) {
  return (
    getBearer(req) ||
    req.headers?.['x-run-secret'] ||
    req.headers?.['x-vercel-cron'] ||
    ''
  );
}

/**
 * Allow Vercel Cron (Authorization: Bearer CRON_SECRET) or manual RUN_SECRET.
 */
function assertAuthorized(req) {
  const provided = String(getRunSecret(req) || '').trim();
  const cron = String(config.secrets.cronSecret || '').trim();
  const run = String(config.secrets.runSecret || '').trim();

  // Vercel sets this header on cron invocations when configured
  const isVercelCron = req.headers?.['x-vercel-cron'] === '1';

  if (isVercelCron && cron && provided === cron) return { ok: true, via: 'cron' };
  if (isVercelCron && cron && getBearer(req) === cron) return { ok: true, via: 'cron-bearer' };
  if (cron && provided === cron) return { ok: true, via: 'cron-secret' };
  if (run && provided === run) return { ok: true, via: 'run-secret' };

  // Local vercel dev without secrets: allow only when no secrets configured
  if (!cron && !run && process.env.NODE_ENV !== 'production') {
    return { ok: true, via: 'dev-open' };
  }

  return { ok: false, error: 'Unauthorized' };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  assertAuthorized,
  getBearer,
  getRunSecret,
  readJsonBody,
};
