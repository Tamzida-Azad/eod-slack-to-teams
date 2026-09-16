const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const teamsSlackRoot = path.resolve(rootDir, '..', 'teams-slack-task-automation');

module.exports = {
  rootDir,
  slack: {
    workspaceUrl: 'https://sjinnovation.slack.com/',
    teamId: 'T0285LK1G',
    channelName: 'calysta-eod',
    channelId: 'C0BES5FDJV8',
  },
  teams: {
    url: 'https://teams.live.com/v2/',
    channelName: 'Calystapro EMR Web Dev',
  },
  paths: {
    // Reuse authenticated Teams+Slack profile from teams-slack project
    browserProfile: path.join(teamsSlackRoot, 'browser-profile'),
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
