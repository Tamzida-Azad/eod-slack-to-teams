const path = require('path');
require('./load-env');
const { publicBaseUrl } = require('./config-base-url');

const rootDir = path.resolve(__dirname, '..');

module.exports = {
  rootDir,
  slack: {
    workspaceUrl: 'https://sjinnovation.slack.com/',
    teamId: 'T0285LK1G',
    channelName: 'calysta-eod',
    channelId: process.env.SLACK_EOD_CHANNEL_ID || 'C0BES5FDJV8',
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    redirectUri:
      process.env.SLACK_REDIRECT_URI || `${publicBaseUrl()}/api/oauth/slack/callback`,
    // User (delegated) scopes — not bot
    userScopes: (
      process.env.SLACK_USER_SCOPES ||
      'channels:history,channels:read,users:read,identify'
    ).split(',').map((s) => s.trim()).filter(Boolean),
  },
  teams: {
    channelName: 'Calystapro EMR Web Dev',
    teamId: process.env.TEAMS_TEAM_ID || '',
    channelId: process.env.TEAMS_CHANNEL_ID || '',
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    tenantId: process.env.AZURE_TENANT_ID || 'common',
    redirectUri:
      process.env.TEAMS_REDIRECT_URI || `${publicBaseUrl()}/api/oauth/teams/callback`,
    scopes: (
      process.env.TEAMS_OAUTH_SCOPES ||
      'offline_access User.Read ChannelMessage.Send Channel.ReadBasic.All'
    )
      .split(/[\s,]+/)
      .filter(Boolean),
  },
  paths: {
    logsDir: path.join(rootDir, 'logs'),
    messagesJson: path.join(rootDir, 'logs', 'eod-messages.json'),
    payloadTxt: path.join(rootDir, 'logs', 'eod-payload.txt'),
    payloadHtml: path.join(rootDir, 'logs', 'eod-payload.html'),
    stateFile: path.join(rootDir, 'logs', 'eod-state.json'),
    tokensFile: path.join(rootDir, 'secrets', 'tokens.enc'),
  },
  eod: {
    maxAttempts: Number(process.env.EOD_MAX_ATTEMPTS || 10),
    retryIntervalMinutes: Number(process.env.EOD_RETRY_INTERVAL_MINUTES || 10),
  },
  secrets: {
    cronSecret: process.env.CRON_SECRET || '',
    runSecret: process.env.RUN_SECRET || process.env.CRON_SECRET || '',
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  },
  publicBaseUrl,
};
