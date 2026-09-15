/**
 * EOD state store — same JSON schema as legacy logs/eod-state.json.
 * File locally; Vercel KV when KV_REST_API_URL (or STATE_BACKEND=kv) is set.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { dhakaParts, addCalendarDays, dateKey } = require('./eod-calendar');

const DEFAULT_STATE = { days: {} };
const KV_KEY = 'eod-state';

function useKv() {
  if (process.env.STATE_BACKEND === 'file') return false;
  if (process.env.STATE_BACKEND === 'kv') return true;
  return Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE, days: {} };
  return {
    days: raw.days && typeof raw.days === 'object' ? raw.days : {},
    baselineKey: raw.baselineKey || null,
    initializedAt: raw.initializedAt || null,
    updatedAt: raw.updatedAt || null,
    lastRun: raw.lastRun || null,
  };
}

function createFileStore(filePath = config.paths.stateFile) {
  return {
    kind: 'file',
    async load() {
      try {
        if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE, days: {} };
        return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch {
        return { ...DEFAULT_STATE, days: {} };
      }
    },
    async save(state) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const payload = {
        updatedAt: new Date().toISOString(),
        initializedAt: state.initializedAt || null,
        baselineKey: state.baselineKey || null,
        days: state.days || {},
        lastRun: state.lastRun || null,
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    },
  };
}

function createKvStore() {
  const { kv } = require('./kv-rest');
  return {
    kind: 'kv',
    async load() {
      const raw = await kv.get(KV_KEY);
      return normalizeState(raw);
    },
    async save(state) {
      const payload = {
        updatedAt: new Date().toISOString(),
        initializedAt: state.initializedAt || null,
        baselineKey: state.baselineKey || null,
        days: state.days || {},
        lastRun: state.lastRun || null,
      };
      await kv.set(KV_KEY, payload);
    },
  };
}

function createStateStore(options = {}) {
  if (options.store) return options.store;
  if (options.filePath) return createFileStore(options.filePath);
  return useKv() ? createKvStore() : createFileStore();
}

async function loadState(store) {
  const s = store || createStateStore();
  return s.load();
}

async function saveState(state, store) {
  const s = store || createStateStore();
  await s.save(state);
}

async function ensureBaseline(state, now = new Date(), store) {
  if (state.baselineKey) return state;
  const real = dhakaParts(now);
  state.baselineKey = dateKey(addCalendarDays(real, -4));
  state.initializedAt = new Date().toISOString();
  await saveState(state, store);
  return state;
}

async function markPosted(state, key, extra = {}, store) {
  state.days[key] = {
    status: 'posted',
    postedAt: new Date().toISOString(),
    attempts: extra.attempts || 1,
    updateCount: extra.updateCount ?? 0,
    catchUp: Boolean(extra.catchUp),
  };
  await saveState(state, store);
}

async function markEmpty(state, key, extra = {}, store) {
  state.days[key] = {
    status: 'empty',
    postedAt: new Date().toISOString(),
    attempts: extra.attempts || 1,
    updateCount: 0,
    catchUp: Boolean(extra.catchUp),
    note: 'No messages in 12:00–11:20 window',
  };
  await saveState(state, store);
}

async function markAttempt(state, key, attempt, errorMessage, store) {
  const prev = state.days[key] || {};
  state.days[key] = {
    ...prev,
    status: 'pending',
    attempts: attempt,
    lastAttemptAt: new Date().toISOString(),
    lastError: errorMessage ? String(errorMessage).slice(0, 500) : null,
  };
  await saveState(state, store);
}

async function markFailed(state, key, attempt, errorMessage, store) {
  state.days[key] = {
    status: 'failed',
    attempts: attempt,
    failedAt: new Date().toISOString(),
    lastError: errorMessage ? String(errorMessage).slice(0, 500) : null,
  };
  await saveState(state, store);
}

function loadStateSync(filePath = config.paths.stateFile) {
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE, days: {} };
    return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return { ...DEFAULT_STATE, days: {} };
  }
}

function saveStateSync(state, filePath = config.paths.stateFile) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    initializedAt: state.initializedAt || null,
    baselineKey: state.baselineKey || null,
    days: state.days || {},
    lastRun: state.lastRun || null,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

module.exports = {
  DEFAULT_STATE,
  KV_KEY,
  useKv,
  createFileStore,
  createKvStore,
  createStateStore,
  normalizeState,
  loadState,
  saveState,
  ensureBaseline,
  markPosted,
  markEmpty,
  markAttempt,
  markFailed,
  loadStateSync,
  saveStateSync,
};
