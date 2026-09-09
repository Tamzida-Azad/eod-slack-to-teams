# EOD Slack → Teams (no LLM)

Reads Slack `#calysta-eod` updates for a calendar day, formats them, and posts to Teams **Calystapro EMR Web Dev**.

**Full walkthrough for anyone new to this project:** see [HOW_IT_WORKS.md](./HOW_IT_WORKS.md).

## Spec

| Item | Value |
|------|--------|
| Source | Slack `#calysta-eod` (Asia/Dhaka) |
| Message window | **12:00 PM – 11:20 PM** that day |
| Destination | Teams `Calystapro EMR Web Dev` |
| Profile | Reuses `../teams-slack-task-automation/browser-profile` |
| Schedule | Mon–Fri **11:30 PM** Asia/Dhaka |
| Gatekeeper | Up to **10** attempts, **10 min** apart; stop on first success |
| Catch-up | On wakeup, backfill **every missed weekday** (each with its own date header), then still run that night’s 11:30 PM for today |
| LLM | None — Playwright scrape + Node format + Teams paste |

## Format

- Header: **EOD Updates** + `MM/DD/YYYY` (the EOD’s calendar date — not the run date)
- Catch-up footer: `EOD Automation · Catch-up for MM/DD/YYYY · Scheduled by Cursor`
- **Bold** Slack display names
- Ticket lines (`#1234`): title before status hyphens; nested `-` status lines; blank line between ticket tasks
- Simple text bullets: compact (no blank lines between)
- Blank line between members

## Setup

```bash
cd C:\Users\TAMZIDA\qa-automation\eod-slack-to-teams
npm install
```

Ensure Teams + Slack are signed in on the shared profile:

```bash
cd ..\teams-slack-task-automation
npm run save-auth
```

Register the scheduled task:

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

Force include today’s post before 11:30 PM:

```bash
set EOD_FORCE_TODAY=1
npm run run-daily
```

Faster retries while testing (ms instead of 10 minutes):

```bash
set EOD_RETRY_INTERVAL_MS=5000
npm run run-daily
```

State file: `logs/eod-state.json` (posted / empty / failed days).

## Task

| Setting | Value |
|---------|--------|
| Name | `SJ-EOD-Slack-To-Teams` |
| Schedule | Mon–Fri 11:30 PM Asia/Dhaka |
| Missed | `StartWhenAvailable` (then gatekeeper retries + multi-day backfill) |
