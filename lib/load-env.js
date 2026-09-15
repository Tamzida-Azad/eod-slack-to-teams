/**
 * Load .env once at process start (local + vercel-dev).
 * Safe no-op if file missing.
 */
const { loadDotEnv } = require('./env-file');

let loaded = false;
function ensureEnvLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    loadDotEnv({ override: false });
  } catch {
    // ignore
  }
}

ensureEnvLoaded();

module.exports = { ensureEnvLoaded };
