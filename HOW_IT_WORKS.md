# How EOD Slack → Teams Works

This document explains the **eod-slack-to-teams** automation for anyone who needs to run, debug, or extend it.

**Repo:** https://github.com/Tamzida-Azad/eod-slack-to-teams  
**Purpose:** Collect daily End-of-Day (EOD) updates from Slack and post a formatted digest to Microsoft Teams — with no LLM.

---

## What it does (one sentence)

Every weekday night it reads messages from Slack `#calysta-eod` for that day (12:00 PM–11:20 PM Asia/Dhaka), formats them, and posts **EOD Updates** to Teams channel **Calystapro EMR Web Dev**.

---

## Business rules

| Rule | Detail |
|------|--------|
| Timezone | **Asia/Dhaka (GMT+6)** for all date/time decisions |
| Source | Slack channel `#calysta-eod` (SJ Innovation workspace) |
| Destination | Teams **Calystapro EMR Web Dev** |
| Which messages count | Posted on that calendar day between **12:00 PM and 11:20 PM** inclusive |
| When it posts | Mon–Fri **11:30 PM** Dhaka |
| Weekends | No scheduled post; Saturday/Sunday are not EOD days |
| Empty day | If no messages in the window → mark day complete, **do not** post an empty Teams message |
| Catch-up | If the PC was off / a run failed → on the next run, backfill **every missed weekday**, each as its **own** Teams post with that day’s date |
| Today still runs | Catch-up does **not** replace that night’s 11:30 PM post for the current day |
| Retries (gatekeeper) | Up to **10** attempts per day, **10 minutes** apart; **stop on first success** |

### Example timeline

Assume PC was off Mon 8th and Tue 9th nights, and wakes **Wed 10th at 11:00 AM**:

1. Immediate catch-up posts:
   - `EOD Updates` / `09/08/2026` (Monday’s window)
   - `EOD Updates` / `09/09/2026` (Tuesday’s window)
2. Later that night at **11:30 PM**:
   - Normal post for **Wednesday** `09/10/2026`

Clients can tell days apart because the **header date** is always the EOD’s calendar date (not the run date). Catch-up posts also use footer:

`EOD Automation · Catch-up for MM/DD/YYYY · Scheduled by Cursor`

---

## Architecture (no LLM)

```
Vercel Cron / UI Run
        │
        ▼
/api/run-daily
        │
        ├─ lib/token-store.js   ← AES-encrypted user OAuth tokens
        ├─ lib/scrape-slack.js  ← Slack Web API as connected user (xoxp)
        ├─ lib/format-eod.js
        └─ lib/post-teams.js    ← Graph channel message as connected user

Integrations UI
  /integrations/slack  → Slack user OAuth
  /integrations/teams  → Microsoft user OAuth
```

| File | Role |
|------|------|
| `lib/token-store.js` | Encrypted Slack/Teams token store (`secrets/tokens.enc` + KV) |
| `lib/oauth-slack.js` / `lib/oauth-teams.js` | OAuth start/exchange/refresh |
| `lib/scrape-slack.js` | Slack history as user |
| `lib/post-teams.js` | Graph Teams message as user |
| `api/oauth/*/start.js` + `callback.js` | OAuth redirects |
| `api/integrations/status.js` | Safe status (no raw tokens) |
| `src/ui/main.js` | Status + integrations SPA |

**Auth model:** Slack/Teams apps are OAuth clients only. After Connect, user tokens are written into **`.env`** (`SLACK_USER_*`, `TEAMS_USER_*`, status/expiry). All channel reads/posts use those env tokens. If a token expires, status shows **expired**, `.env` is updated, and the pipeline fails closed until reconnect. Optional encrypted mirror: `secrets/tokens.enc` + KV when `TOKEN_ENCRYPTION_KEY` is set.

---

## Message selection details

1. Call Slack `conversations.history` for the target day’s Dhaka window (12:00–11:20).
2. Resolve display names with `users.info`.
3. Keep only messages whose `ts` falls on the target calendar day inside the window.
4. Prefer messages that look like EOD content (`EOD`, ticket `#1234`, etc.) when mixed content is present.

Messages **before noon** or **after 11:20 PM** that day are ignored for that day’s digest.

---

## Output format (Teams)

```
EOD Updates
MM/DD/YYYY

*Member Display Name*
  • Ticket or task title
      - nested status line

*Another Member*
  • …
```

- Header date = the EOD day being reported.
- Member names are bold (Adaptive Card / markdown).
- Ticket lines (`#1234`) may split title vs status on ` - `.
- Footer identifies scheduled automation (and catch-up when applicable).

---

## Schedule (Vercel)

| Setting | Value |
|---------|--------|
| Cron path | `/api/run-daily` |
| Schedule | `*/10 17-18 * * 1-5` (UTC) ≈ Dhaka evening window |
| Auth | `Authorization: Bearer CRON_SECRET` |
| Behavior | One attempt per due day per invoke; retries via later cron ticks |

Local CLI still supports in-process retries (`npm run run-daily`) using the same `lib/` code.
| Time limit | 2 hours (covers scrape/post + up to ~10×10 min retries) |

Register / refresh the task:

```powershell
cd C:\Users\TAMZIDA\qa-automation\eod-slack-to-teams
powershell -ExecutionPolicy Bypass -File .\scripts\register-task.ps1
```

Useful checks:

```powershell
Get-ScheduledTask -TaskName 'SJ-EOD-Slack-To-Teams' | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName 'SJ-EOD-Slack-To-Teams'
```

---

## Gatekeeper (retries)

For **each** day that still needs a post:

1. Attempt scrape → format → Teams post.
2. On **success** → mark day `posted` (or `empty`) and **stop** further retries for that day.
3. On **failure** → wait **10 minutes**, try again.
4. After **10** failures → mark day `failed` and move on (does not block other days).

Success on attempt 5 means attempts 6–10 are **not** run.

---

## State file

Path: `logs/eod-state.json` (gitignored).

Tracks:

- `baselineKey` — first-run lookback floor (avoids flooding Teams with very old history)
- Per day (`YYYY-MM-DD`):
  - `posted` — successfully sent to Teams
  - `empty` — window had no messages; treated as done
  - `pending` — failed attempt(s), may retry
  - `failed` — exhausted 10 attempts

Days already `posted` / `empty` / `failed` are not auto-reposted.

---

## Auth / browser profile

Uses the **same** Playwright persistent profile as the sibling project:

`../teams-slack-task-automation/browser-profile`

That profile must already be signed into **Slack** and **Teams**.  
If a login wall appears, stop and re-auth:

```bash
cd ..\teams-slack-task-automation
npm run save-auth
```

Never commit the browser profile or `.env` secrets.

---

## How to run manually

```bash
cd C:\Users\TAMZIDA\qa-automation\eod-slack-to-teams
npm install
```

| Command | What it does |
|---------|----------------|
| `npm run run-daily` | Full pipeline (backfill missed + today if ≥ 11:30 PM) |
| `npm run run-daily:dry` | Same logic, print payload, **no** Teams post |
| `npm run scrape` | Scrape only → `logs/eod-messages.json` |
| `npm run format` | Format last scrape → payload files |
| `npm run post-teams` | Post last payload only |
| `npm run test-scrape-filter` | Unit tests for window / catch-up filters |
| `npm run test-format` | Sample format preview |

### Useful environment variables

| Variable | Effect |
|----------|--------|
| `EOD_DRY_RUN=1` | Do not post to Teams |
| `EOD_FORCE_TODAY=1` | Include today’s EOD even before 11:30 PM |
| `EOD_HEADED=1` | Show the browser window |
| `EOD_RETRY_INTERVAL_MS=5000` | Faster retries while testing (ms) |
| `EOD_MAX_ATTEMPTS` | Override max retries (default 10) |
| `EOD_LOOKBACK_DAYS` | How far back to scan for missed weekdays (default 7) |
| `EOD_TARGET_DATE=YYYY-MM-DD` | When running `npm run scrape`, force that target day |

---

## Logs

| Path | Contents |
|------|----------|
| `logs/scheduler.log` | Bat wrapper start/success/fail lines |
| `logs/pipeline-*.log` | JSON lines for each orchestrator run |
| `logs/eod-messages.json` | Last scrape snapshot |
| `logs/eod-payload.txt` / `.html` | Last formatted payload |
| `logs/eod-payload-YYYY-MM-DD.txt` | Per-day payload copy |
| `logs/eod-state.json` | Posted / empty / failed day tracker |

---

## Typical failure modes

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| Task never ran at 11:30 | PC off / asleep / not interactively logged on | Turn on PC; `StartWhenAvailable` + catch-up should backfill |
| Ran but “No EOD updates” | Nobody posted in 12:00–11:20, or timestamps not resolved to that day | Check Slack `#calysta-eod`; inspect `eod-messages.json` |
| Login wall | Browser profile session expired | Re-run `npm run save-auth` in teams-slack project |
| Posted wrong day | Rare filter bug / wrong target | Check pipeline log `target` / payload header date |
| Stuck retrying | Transient Teams/Slack error | Wait for gatekeeper; check `eod-state.json` and pipeline logs |

---

## Setup checklist (new machine)

1. Clone https://github.com/Tamzida-Azad/eod-slack-to-teams  
2. Ensure sibling folder `teams-slack-task-automation` exists with a signed-in `browser-profile`  
3. `npm install` in this repo  
4. `npm run run-daily:dry` once to verify scrape/format  
5. Register the Windows scheduled task with `scripts\register-task.ps1`  
6. Confirm next run time: `Get-ScheduledTaskInfo` for `SJ-EOD-Slack-To-Teams`

---

## What this project does *not* do

- Does **not** use an LLM / Cursor agent for categorization  
- Does **not** post on Saturday or Sunday as normal EOD days  
- Does **not** invent EODs — only Slack messages already written by the team  
- Does **not** replace human judgment if Slack content is wrong or incomplete  

---

## Quick FAQ

**Q: Why 11:20 PM cut-off if the job runs at 11:30?**  
A: Gives a short buffer so last EODs are included, then the 11:30 job posts a stable snapshot.

**Q: If catch-up posts Monday and Tuesday on Wednesday morning, will Wednesday night still post?**  
A: Yes. Catch-up and the nightly schedule are independent.

**Q: How do clients know which day an EOD is for?**  
A: The first lines are always `EOD Updates` and `MM/DD/YYYY` for that EOD day.

**Q: Can I post today’s EOD early for testing?**  
A: Yes — set `EOD_FORCE_TODAY=1` (prefer dry-run first).
