const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEFAULT_STATE = { days: {} };

function statePath() {
  return config.paths.stateFile;
}

function loadState() {
  const file = statePath();
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_STATE, days: {} };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      days: raw.days && typeof raw.days === 'object' ? raw.days : {},
      baselineKey: raw.baselineKey || null,
      initializedAt: raw.initializedAt || null,
    };
  } catch {
    return { ...DEFAULT_STATE, days: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    initializedAt: state.initializedAt || null,
    baselineKey: state.baselineKey || null,
    days: state.days || {},
  };
  fs.writeFileSync(statePath(), JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * First run: only catch up ~4 calendar days so we do not flood Teams with old history.
 */
function ensureBaseline(state, now = new Date()) {
  if (state.baselineKey) return state;
  const { dhakaParts, addCalendarDays, dateKey } = require('./eod-calendar');
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
};
