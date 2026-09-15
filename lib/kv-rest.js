/**
 * Minimal Redis REST client (Vercel KV / Upstash compatible).
 * Uses KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).
 */
function restConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Missing KV_REST_API_URL/TOKEN (or UPSTASH_REDIS_REST_URL/TOKEN)');
  }
  return { url: url.replace(/\/$/, ''), token };
}

async function restCommand(command, fetchImpl = fetch) {
  const { url, token } = restConfig();
  const res = await fetchImpl(`${url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `KV REST HTTP ${res.status}`);
  }
  return data.result;
}

const kv = {
  async get(key) {
    const result = await restCommand(['GET', key]);
    if (result == null) return null;
    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }
    return result;
  },
  async set(key, value) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await restCommand(['SET', key, payload]);
    return 'OK';
  },
};

module.exports = { kv, restCommand, restConfig };
