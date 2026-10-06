# How EOD Slack → Teams Works

This document explains the **eod-slack-to-teams** automation for anyone who needs to run, debug, or extend it.

**Repo:** https://github.com/Tamzida-Azad/eod-slack-to-teams  
**Purpose:** Collect daily End-of-Day (EOD) updates from Slack and post a formatted digest to Microsoft Teams — with no LLM.

---

## What it does (one sentence)

Every weekday night it reads messages from your configured Slack EOD channel for that day (12:00 PM–11:20 PM Asia/Dhaka), formats them, and posts **EOD Updates** to your configured Teams channel.

---

## Business rules

| Rule | Detail |
|------|--------|
| Timezone | **Asia/Dhaka (GMT+6)** for all date/time decisions |
| Source | Slack channel (`EOD_SLACK_CHANNEL_NAME` / ID in `.env`) |
| Destination | Teams channel (`EOD_TEAMS_CHANNEL_NAME` in `.env`) |
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

`EOD Automation · Catch-up for MM/DD/YYYY`

---

## Architecture (no LLM)

```
Windows Task Scheduler (Mon–Fri 11:30 PM)
        │
        ▼
scripts/run-daily.bat
        │
        ▼
src/run-daily.js          ← orchestrator (backfill + today + retries)
        │
        ├─ eod-state.json  ← which days already posted / empty / failed
        ├─ eod-calendar.js ← Dhaka dates, 12:00–11:20 window, missed days
        │
        ├─ scrape-slack-eod.js  → Playwright opens Slack (shared browser profile)
        ├─ format-eod.js        → plain text + HTML digest
        └─ post-teams.js        → Playwright pastes into Teams
```

| File | Role |
|------|------|
| `src/run-daily.js` | Main entry: decide which days need posting, retry gatekeeper |
| `src/eod-calendar.js` | Dhaka calendar helpers, message window, schedule checks |
| `src/eod-state.js` | Persist posted/empty/failed days under `logs/eod-state.json` |
| `src/scrape-slack-eod.js` | Browser scrape of the EOD Slack channel for a **target date** |
| `src/format-eod.js` | Build Teams payload (names, tickets, nesting) |
| `src/post-teams.js` | Open Teams and send the payload |
| `src/config.js` | Channel IDs, paths, retry defaults |
| `scripts/register-task.ps1` | Registers Windows task `SJ-EOD-Slack-To-Teams` |
| `scripts/run-daily.bat` | Task action; appends to `logs/scheduler.log` |

---

## Message selection details

1. Open the configured Slack EOD channel with the authenticated Chromium profile.
2. Scroll the message list (including upward for older catch-up days).
3. Read each message’s timestamp and day divider (`Today` / `Yesterday` / full date).
4. Keep only messages that resolve to the **target calendar day**.
5. Keep only those whose clock time is in **12:00 PM – 11:20 PM**.
6. Prefer messages that look like EOD content (`EOD`, ticket `#1234`, etc.) when mixed content is present.

**Important:** Bare Slack times like `7:58 PM` (without “Today at”) are supported via day dividers / evening logic so evening EODs are not dropped.

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
- Member names are bold.
- Ticket lines (`#1234`) may split title vs status on ` - `.
- Footer identifies scheduled automation (and catch-up when applicable).

---

## Schedule & Windows task

| Setting | Value |
|---------|--------|
| Task name | `SJ-EOD-Slack-To-Teams` |
| Trigger | Weekdays **11:30 / 11:40 / 11:50 PM**, plus **every 10 min 12:00–1:20 AM** (Tue–Sat) for kill recovery |
| Action | `scripts\run-daily.bat` |
| Missed start | `StartWhenAvailable` — when the PC comes back on, Windows starts the task once |
| Concurrent | `IgnoreNew` — if the gatekeeper is still running, recovery slots are skipped |
| Logon | Interactive (user must be able to run a browser session) |
| Time limit | 3 hours (covers scrape/post + up to ~10×10 min in-process retries) |

Register / refresh the task:

```powershell
cd path\to\eod-slack-to-teams
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

1. Attempt scrape → format → **checkpoint `pending`** → Teams post (5 min post timeout).
2. On **success** → mark day `posted` (or `empty`) and **stop** further retries for that day.
3. On **failure** → wait **10 minutes**, try again (up to **10** attempts in one process).
4. After **10** failures in one process → mark day `failed`, then exit.
5. **Recovery:** if Windows kills the task mid-post (`0x41306`), or a day is still `pending`/`failed`, the next **10-minute recovery trigger** starts a fresh run and tries again until `posted`/`empty`.
6. Member names are posted **without Slack status emojis**; task `:)` shortcodes are converted so Teams does not glue the next name onto the prior line.

Success on attempt 5 means attempts 6–10 are **not** run in that process.

---

## State file

Path: `logs/eod-state.json` (gitignored).

Tracks:

- `baselineKey` — first-run lookback floor (avoids flooding Teams with very old history)
- Per day (`YYYY-MM-DD`):
  - `posted` — successfully sent to Teams
  - `empty` — window had no messages; treated as done
  - `pending` — failed attempt(s), may retry
  - `failed` — exhausted 10 attempts in one process (still eligible for the next recovery run)

Days already `posted` / `empty` are not auto-reposted. `pending` / `failed` stay eligible until success.

---

## Auth / browser profile

Playwright uses the directory in `EOD_BROWSER_PROFILE_DIR` (default: `./browser-profile` in this repo). That profile must be signed into **Slack** and **Teams**. If a login wall appears, re-authenticate on that profile using your org’s save-auth flow.

Copy `.env.example` → `.env` and set Slack/Teams channel IDs and names there — never commit `.env` or the browser profile.

---

## How to run manually

```bash
cd path\to\eod-slack-to-teams
cp .env.example .env   # then edit
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
| `.env` | `EOD_SLACK_*`, `EOD_TEAMS_CHANNEL_NAME`, `EOD_BROWSER_PROFILE_DIR` (required for production) |

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
| Ran but “No EOD updates” | Nobody posted in 12:00–11:20, or timestamps not resolved to that day | Check your Slack EOD channel; inspect `eod-messages.json` |
| Login wall | Browser profile session expired | Re-sign in on `EOD_BROWSER_PROFILE_DIR` |
| Posted wrong day | Rare filter bug / wrong target | Check pipeline log `target` / payload header date |
| Stuck retrying | Transient Teams/Slack error | Wait for gatekeeper; check `eod-state.json` and pipeline logs |

---

## Setup checklist (new machine)

1. Clone https://github.com/Tamzida-Azad/eod-slack-to-teams  
2. Copy `.env.example` → `.env` and set Slack/Teams values  
3. Sign in on the Playwright profile path in `.env`; `npm install` in this repo  
4. `npm run run-daily:dry` once to verify scrape/format  
5. Register the Windows scheduled task with `scripts\register-task.ps1`  
6. Confirm next run time: `Get-ScheduledTaskInfo` for `SJ-EOD-Slack-To-Teams`

---

## What this project does *not* do

- Does **not** use an LLM for categorization  
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
