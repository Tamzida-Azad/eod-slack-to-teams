# EOD Slack → Teams (no LLM)

Reads a Slack EOD channel for a calendar day, formats messages, and posts to a Microsoft Teams channel.

**Full walkthrough:** [HOW_IT_WORKS.md](./HOW_IT_WORKS.md).

## Spec

| Item | Value |
|------|--------|
| Source | Slack channel (configured in `.env`) |
| Message window | **12:00 PM – 11:20 PM** Asia/Dhaka that day |
| Destination | Teams channel (configured in `.env`) |
| Browser profile | `EOD_BROWSER_PROFILE_DIR` or `./browser-profile` (local only) |
| Schedule | Mon–Fri **11:30 PM** Asia/Dhaka |
| Gatekeeper | Up to **10** attempts, **10 min** apart; stop on first success |
| Catch-up | Backfill missed weekdays, then run tonight’s EOD |
| LLM | None — Playwright scrape + Node format + Teams paste |

## Setup

```bash
git clone https://github.com/Tamzida-Azad/eod-slack-to-teams.git
cd eod-slack-to-teams
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env with your Slack team/channel IDs and Teams channel name
```

Sign in once on the Playwright profile directory referenced by `EOD_BROWSER_PROFILE_DIR` (your own save-auth flow or an existing signed-in profile).

Register the scheduled task (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-task.ps1
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run test-format` | Sample format preview (no browser) |
| `npm run test-scrape-filter` | Window / catch-up unit checks |
| `npm run scrape` | Scrape Slack → `logs/eod-messages.json` |
| `npm run format` | Format last scrape → `logs/eod-payload.txt` |
| `npm run run-daily:dry` | Orchestrator dry-run (no Teams post) |
| `npm run run-daily` | Full pipeline (backfill + today if due + retries) |
| `npm run post-teams` | Post last payload only |

Dry-run:

```bash
set EOD_DRY_RUN=1
npm run run-daily
```

State file: `logs/eod-state.json` (posted / empty / failed days).

## Security

- **Do not commit** `.env`, `browser-profile/`, or `logs/` — they may contain session data and message content.
- Use fictional sample data only in tests; keep real EOD text in local logs.

## Task

| Setting | Value |
|---------|--------|
| Name | `SJ-EOD-Slack-To-Teams` |
| Schedule | Mon–Fri 11:30 PM Asia/Dhaka |
| Missed | `StartWhenAvailable` (gatekeeper retries + multi-day backfill) |
