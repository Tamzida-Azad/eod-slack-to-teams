/**
 * Slack Web API scrape using the authenticated user's OAuth token (xoxp).
 */
const fs = require('fs');
const config = require('./config');
const { dateKey } = require('./eod-calendar');
const {
  getDateWindow,
  preferEodLikeMessages,
  dhakaLocalToUnix,
  isMessageInTargetWindow,
  formatClock12,
  unixToDhakaParts,
} = require('./message-window');
const { getValidSlackAccessToken, isSlackAuthError } = require('./oauth-slack');
const { markExpired } = require('./token-store');

function cleanBody(body) {
  return String(body || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slackTextToPlain(text) {
  return String(text || '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function slackApi(method, params = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const token =
    options.accessToken ||
    (await getValidSlackAccessToken({ fetchImpl, tokens: options.tokens }));
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) {
    if (isSlackAuthError(data.error)) {
      await markExpired('slack', data.error);
      const err = new Error(`Slack auth failed (${data.error}) — reconnect at /integrations/slack`);
      err.code = 'slack_expired';
      throw err;
    }
    throw new Error(`Slack API ${method} failed: ${data.error || res.status}`);
  }
  return data;
}

async function resolveUserName(userId, cache, options) {
  if (!userId) return 'Unknown';
  if (cache.has(userId)) return cache.get(userId);
  try {
    const data = await slackApi('users.info', { user: userId }, options);
    const name =
      data.user?.profile?.display_name ||
      data.user?.real_name ||
      data.user?.name ||
      userId;
    cache.set(userId, name);
    return name;
  } catch {
    cache.set(userId, userId);
    return userId;
  }
}

/**
 * @param {{
 *   targetDate?: object,
 *   now?: Date,
 *   fetchImpl?: Function,
 *   writeFiles?: boolean,
 *   accessToken?: string,
 *   tokens?: object,
 * }} options
 */
async function scrapeSlackEod(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const targetDate = options.targetDate || null;
  const window = getDateWindow(targetDate, now);
  const writeFiles = options.writeFiles !== false;
  const apiOpts = {
    fetchImpl,
    accessToken: options.accessToken,
    tokens: options.tokens,
  };

  if (!targetDate && window.isWeekend) {
    return {
      skipped: true,
      reason: 'weekend',
      window,
      messages: [],
      stats: { messagesKept: 0 },
    };
  }

  const oldest = dhakaLocalToUnix(
    window.target.year,
    window.target.month,
    window.target.day,
    12,
    0,
    0
  );
  const latest = dhakaLocalToUnix(
    window.target.year,
    window.target.month,
    window.target.day,
    23,
    20,
    59
  );

  const channel = config.slack.channelId;
  const userCache = new Map();
  let cursor;
  const rawMessages = [];

  do {
    const params = {
      channel,
      oldest: String(oldest),
      latest: String(latest),
      inclusive: 'true',
      limit: '200',
    };
    if (cursor) params.cursor = cursor;
    const data = await slackApi('conversations.history', params, apiOpts);
    rawMessages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);

  let messages = [];
  for (const msg of rawMessages) {
    if (msg.subtype && msg.subtype !== 'thread_broadcast') continue;
    if (!msg.text && !msg.blocks) continue;
    const ts = Number(msg.ts);
    if (!isMessageInTargetWindow(ts, window.target)) continue;
    const author = await resolveUserName(msg.user, userCache, apiOpts);
    const body = cleanBody(slackTextToPlain(msg.text || ''));
    if (!author || !body) continue;
    const parts = unixToDhakaParts(ts);
    messages.push({
      author,
      timestamp: formatClock12(parts.hour, parts.minute),
      body,
      ts: msg.ts,
    });
  }

  messages.sort((a, b) => Number(a.ts) - Number(b.ts));
  messages = preferEodLikeMessages(messages);

  const payload = {
    scrapedAt: new Date().toISOString(),
    window,
    targetDate: window.target,
    targetDateKey: dateKey(window.target),
    channel: config.slack.channelName,
    messages,
    stats: {
      messagesKept: messages.length,
      authors: [...new Set(messages.map((m) => m.author))],
    },
  };

  if (writeFiles) {
    fs.mkdirSync(config.paths.logsDir, { recursive: true });
    fs.writeFileSync(config.paths.messagesJson, JSON.stringify(payload, null, 2), 'utf8');
  }

  return payload;
}

module.exports = {
  scrapeSlackEod,
  slackTextToPlain,
  cleanBody,
  preferEodLikeMessages,
  getDateWindow,
  slackApi,
};
