/**
 * Sync-compatible state helpers for local scripts (file-backed).
 * Async store API lives in lib/eod-state.js.
 */
const {
  createFileStore,
  ensureBaseline: ensureBaselineAsync,
  markPosted: markPostedAsync,
  markEmpty: markEmptyAsync,
  markAttempt: markAttemptAsync,
  markFailed: markFailedAsync,
  loadStateSync,
  saveStateSync,
} = require('../lib/eod-state');
const config = require('../lib/config');

const store = createFileStore(config.paths.stateFile);

function loadState() {
  return loadStateSync(config.paths.stateFile);
}

function saveState(state) {
  saveStateSync(state, config.paths.stateFile);
}

function ensureBaseline(state, now = new Date()) {
  if (state.baselineKey) return state;
  // sync path mirroring lib ensureBaseline
  const { dhakaParts, addCalendarDays, dateKey } = require('../lib/eod-calendar');
  const real = dhakaParts(now);
  state.baselineKey = dateKey(addCalendarDays(real, -4));
  state.initializedAt = new Date().toISOString();
  saveState(state);
  return state;
}

function markPosted(state, key, extra = {}) {
  state.days[key] = {
    status: 'posted',
    postedAt: new Date().toISOString(),
    attempts: extra.attempts || 1,
    updateCount: extra.updateCount ?? 0,
    catchUp: Boolean(extra.catchUp),
  };
  saveState(state);
}

function markEmpty(state, key, extra = {}) {
  state.days[key] = {
    status: 'empty',
    postedAt: new Date().toISOString(),
    attempts: extra.attempts || 1,
    updateCount: 0,
    catchUp: Boolean(extra.catchUp),
    note: 'No messages in 12:00–11:20 window',
  };
  saveState(state);
}

function markAttempt(state, key, attempt, errorMessage) {
  const prev = state.days[key] || {};
  state.days[key] = {
    ...prev,
    status: 'pending',
    attempts: attempt,
    lastAttemptAt: new Date().toISOString(),
    lastError: errorMessage ? String(errorMessage).slice(0, 500) : null,
  };
  saveState(state);
}

function markFailed(state, key, attempt, errorMessage) {
  state.days[key] = {
    status: 'failed',
    attempts: attempt,
    failedAt: new Date().toISOString(),
    lastError: errorMessage ? String(errorMessage).slice(0, 500) : null,
  };
  saveState(state);
}

module.exports = {
  loadState,
  saveState,
  ensureBaseline,
  markPosted,
  markEmpty,
  markAttempt,
  markFailed,
  store,
  ensureBaselineAsync,
  markPostedAsync,
  markEmptyAsync,
  markAttemptAsync,
  markFailedAsync,
};
