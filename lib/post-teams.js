/**
 * Post EOD digest to Teams via Microsoft Graph as the authenticated user.
 */
const config = require('./config');
const { getValidTeamsAccessToken, isTeamsAuthError } = require('./oauth-teams');
const { markExpired } = require('./token-store');

function escapeMd(s) {
  return String(s || '').replace(/([*_`])/g, '\\$1');
}

function blocksToAdaptiveCard(blocks, fallbackText) {
  const body = [];
  for (const b of blocks || []) {
    if (b.style === 'spacer') {
      body.push({ type: 'TextBlock', text: ' ', wrap: true, spacing: 'Small' });
      continue;
    }
    if (b.style === 'bold') {
      body.push({
        type: 'TextBlock',
        text: `**${escapeMd(b.text)}**`,
        wrap: true,
        weight: 'Bolder',
      });
      continue;
    }
    if (b.style === 'italic') {
      body.push({
        type: 'TextBlock',
        text: `_${escapeMd(b.text)}_`,
        wrap: true,
        isSubtle: true,
      });
      continue;
    }
    body.push({ type: 'TextBlock', text: String(b.text || ''), wrap: true });
  }

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    msteams: { width: 'Full' },
  };
}

function blocksToGraphMessage(blocks, payloadText) {
  const card = blocksToAdaptiveCard(blocks, payloadText);
  return {
    body: {
      contentType: 'html',
      content: `<pre>${escapeHtml(payloadText)}</pre>`,
    },
    attachments: [
      {
        id: 'eodAdaptiveCard',
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: card,
      },
    ],
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

/**
 * @param {string} payloadText
 * @param {string} [payloadHtml]
 * @param {{
 *   blocks?: Array,
 *   dryRun?: boolean,
 *   fetchImpl?: Function,
 *   accessToken?: string,
 *   tokens?: object,
 *   teamId?: string,
 *   channelId?: string,
 * }} [options]
 */
async function postToTeams(payloadText, payloadHtml, options = {}) {
  const dryRun = options.dryRun === true || process.env.EOD_DRY_RUN === '1';
  const fetchImpl = options.fetchImpl || fetch;
  const teamId = options.teamId || config.teams.teamId;
  const channelId = options.channelId || config.teams.channelId;
  const graphBody = blocksToGraphMessage(options.blocks, payloadText);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      skipped: true,
      bytes: JSON.stringify(graphBody).length,
    };
  }

  if (!teamId || !channelId) {
    throw new Error('Missing TEAMS_TEAM_ID / TEAMS_CHANNEL_ID');
  }

  const token =
    options.accessToken ||
    (await getValidTeamsAccessToken({ fetchImpl, tokens: options.tokens }));

  const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(graphBody),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    if (isTeamsAuthError(res.status, text)) {
      await markExpired('teams', `HTTP ${res.status}`);
      const err = new Error('Teams auth failed — reconnect at /integrations/teams');
      err.code = 'teams_expired';
      throw err;
    }
    throw new Error(`Teams Graph post failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // ignore
  }

  return { ok: true, status: res.status, id: parsed?.id || null };
}

module.exports = {
  postToTeams,
  blocksToAdaptiveCard,
  blocksToGraphMessage,
};
