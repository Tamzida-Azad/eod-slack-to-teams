const path = require('path');
const { loadEnv } = require('./load-env');

loadEnv();

const rootDir = path.resolve(__dirname, '..');

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and set Slack/Teams values.`
    );
  }
  return value;
}

const browserProfile = process.env.EOD_BROWSER_PROFILE_DIR
  ? path.resolve(process.env.EOD_BROWSER_PROFILE_DIR)
  : path.join(rootDir, 'browser-profile');

module.exports = {
  rootDir,
  slack: {
    workspaceUrl: required('EOD_SLACK_WORKSPACE_URL'),
    teamId: required('EOD_SLACK_TEAM_ID'),
    channelName: process.env.EOD_SLACK_CHANNEL_NAME || 'eod-updates',
    channelId: required('EOD_SLACK_CHANNEL_ID'),
  },
  teams: {
    url: process.env.EOD_TEAMS_URL || 'https://teams.live.com/v2/',
    channelName: required('EOD_TEAMS_CHANNEL_NAME'),
  },
  paths: {
    browserProfile,
    logsDir: path.join(rootDir, 'logs'),
    messagesJson: path.join(rootDir, 'logs', 'eod-messages.json'),
    payloadTxt: path.join(rootDir, 'logs', 'eod-payload.txt'),
    payloadHtml: path.join(rootDir, 'logs', 'eod-payload.html'),
    stateFile: path.join(rootDir, 'logs', 'eod-state.json'),
  },
  eod: {
    /** Max post attempts per day (gatekeeper) */
    maxAttempts: Number(process.env.EOD_MAX_ATTEMPTS || 10),
    /** Minutes between failed attempts */
    retryIntervalMinutes: Number(process.env.EOD_RETRY_INTERVAL_MINUTES || 10),
  },
  timeouts: {
    navigation: 60_000,
    action: 20_000,
  },
};
