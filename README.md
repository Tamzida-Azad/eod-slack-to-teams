# EOD Slack → Teams (Vite + Vercel + User OAuth)

Reads Slack `#calysta-eod` as **your connected Slack user**, formats the digest, and posts to Teams **Calystapro EMR Web Dev** as **your connected Microsoft user**.

**Walkthrough:** [HOW_IT_WORKS.md](./HOW_IT_WORKS.md)

## Spec (business rules unchanged)

| Item | Value |
|------|--------|
| Source | Slack `#calysta-eod` (Asia/Dhaka) |
| Message window | **12:00 PM – 11:20 PM** |
| Destination | Teams `Calystapro EMR Web Dev` (M365 Graph) |
| Auth | **User OAuth** for Slack + Teams (not a bot, not a webhook) |
| Schedule | Vercel Cron every 10 min in evening UTC window |
| Gatekeeper | Up to **10** attempts, **10 min** apart |

## Integrations UI

| Page | Purpose |
|------|---------|
| `/` | EOD status + dry run / run |
| `/integrations` | Slack + Teams connection hub |
| `/integrations/slack` | Connect / reconnect Slack user OAuth |
| `/integrations/teams` | Connect / reconnect Microsoft user OAuth |

Status badges: **connected** / **expired** / **missing**. Expired → reconnect via OAuth.

Tokens are written to **`.env`** after OAuth (`SLACK_USER_ACCESS_TOKEN`, `TEAMS_USER_ACCESS_TOKEN`, status, expiry, user labels). That file is gitignored. Optionally mirror encrypted to `secrets/tokens.enc` + KV when `TOKEN_ENCRYPTION_KEY` is set. Status APIs never return raw tokens.

## Setup

```bash
npm install
cp .env.example .env
```

### 1. Encryption key (optional mirror)

`TOKEN_ENCRYPTION_KEY` is optional. After Connect, tokens are always written into `.env`. If the encryption key is set, a ciphertext mirror is also kept in `secrets/tokens.enc` / KV (needed on Vercel so cron can read tokens).

### 2. Slack user OAuth app

1. Create a Slack app → **OAuth & Permissions** → User Token Scopes: `channels:history`, `channels:read`, `users:read`, `identify`
2. Redirect URL: `https://<host>/api/oauth/slack/callback` (and localhost for `vercel dev`)
3. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`
4. Open `/integrations/slack` → **Connect** (signs in as you; no bot posting)

### 3. Microsoft Teams user OAuth

1. Azure AD app registration → Web redirect `https://<host>/api/oauth/teams/callback`
2. Delegated permissions: `ChannelMessage.Send`, `Channel.ReadBasic.All`, `User.Read`, `offline_access`
3. Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `TEAMS_REDIRECT_URI`
4. Set `TEAMS_TEAM_ID` + `TEAMS_CHANNEL_ID` for **Calystapro EMR Web Dev**
5. Open `/integrations/teams` → **Connect**

Requires **Microsoft 365 work/school** Teams (Graph). Personal `teams.live.com` is not supported.

### 4. Vercel

- Framework Preset: **Other**
- Env vars from `.env.example`
- Link Upstash/KV for token + state mirror
- `CRON_SECRET` for cron auth

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Golden + OAuth store + pipeline tests |
| `npm run build` | Vite production build |
| `npm run vercel-dev` | Local UI + API |
| `npm run run-daily:dry` | Dry run (needs Slack OAuth connected) |
| `npm run run-daily` | Live run (needs Slack + Teams OAuth) |

## Verification

- `npm test` / `npm run build` green
- Connect Slack → badge **connected**
- Connect Teams → badge **connected**
- Dry run uses Slack user token; live run posts via Graph as Teams user
- Disconnect or expire → badge **expired** / **missing** → reconnect
