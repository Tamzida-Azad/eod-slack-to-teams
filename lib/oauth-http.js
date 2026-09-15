/**
 * In-memory OAuth state (single-instance / short-lived).
 * For multi-instance Vercel, state is still validated as opaque random; CSRF risk is low for this ops tool.
 * Prefer cookie when available.
 */
const states = new Map();

function putState(key, value, ttlMs = 10 * 60 * 1000) {
  states.set(key, { value, exp: Date.now() + ttlMs });
}

function takeState(key) {
  const row = states.get(key);
  states.delete(key);
  if (!row) return null;
  if (row.exp < Date.now()) return null;
  return row.value;
}

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const u = new URL(req.url || '', 'http://localhost');
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return {};
  }
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

module.exports = {
  putState,
  takeState,
  getQuery,
  redirect,
  json,
};
