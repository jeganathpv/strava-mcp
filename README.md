# 🏋️ Fitness Coach MCP — Cloudflare Workers Setup

## Prerequisites
- Node.js 18+ installed
- A Cloudflare account (free) → https://dash.cloudflare.com/sign-up
- Your Strava Client ID, Client Secret, and Refresh Token (from earlier steps)

---

## Step 1 — Install dependencies

```bash
npm install
```

---

## Step 2 — Login to Cloudflare

```bash
npx wrangler login
```
This opens a browser → log in → authorize Wrangler. One time only.

---

## Step 3 — Add Strava secrets

Run each command and paste the value when prompted:

```bash
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_REFRESH_TOKEN
```

These are stored encrypted in Cloudflare — never in your code.

---

## Step 4 — Deploy

```bash
npm run deploy
```

You'll get a permanent URL like:
```
https://fitness-coach-mcp.YOUR-NAME.workers.dev
```

Your MCP endpoint is:
```
https://fitness-coach-mcp.YOUR-NAME.workers.dev/mcp
```

---

## Step 5 — Update Strava App Callback Domain

1. Go to https://www.strava.com/settings/api
2. Update **Authorization Callback Domain** to:
   ```
   fitness-coach-mcp.YOUR-NAME.workers.dev
   ```
3. Update **Website** to:
   ```
   https://fitness-coach-mcp.YOUR-NAME.workers.dev
   ```

---

## Step 6 — Re-do OAuth to get fresh Refresh Token

Since the domain changed, get a new refresh token:

**Open this URL in browser** (replace YOUR_CLIENT_ID):
```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=https://fitness-coach-mcp.YOUR-NAME.workers.dev/callback&approval_prompt=force&scope=read,activity:read_all,activity:write
```

Copy the `code` from the redirect URL, then run:
```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code
```

Update the secret with the new refresh token:
```bash
npx wrangler secret put STRAVA_REFRESH_TOKEN
```

---

## Step 7 — Add to Claude.ai

1. Go to **claude.ai → Settings → Connectors**
2. Click **Add custom connector**
3. Name: `Strava Fitness Coach`
4. URL: `https://fitness-coach-mcp.YOUR-NAME.workers.dev/mcp`
5. Click **Add**

Also connect **Notion** from the native connectors directory.

---

## Step 8 — Create your Claude Project

1. Go to **claude.ai → Projects → New Project**
2. Name: `🏋️ Fitness Coach`
3. Paste contents of `SYSTEM_PROMPT.md` into Project Instructions
4. Enable both connectors: Strava + Notion

---

## Done! Log from anywhere 📱

From mobile, web, or desktop — just paste your workout text into the project.
Claude handles everything automatically.

---

## Health Check

Verify your server is running:
```
https://fitness-coach-mcp.YOUR-NAME.workers.dev/health
```

Should return: `{"status":"ok","server":"fitness-coach-mcp"}`

---

## Updating the server

After any code changes:
```bash
npm run deploy
```
That's it — live in seconds globally.

---

## MCP Tools

| Tool | What it does |
|---|---|
| `get_latest_activity` | Fetch today's Strava activity by type |
| `get_activity_detail` | Full splits, laps, HR, power |
| `get_week_activities` | All sessions for Mon–Sun week |
| `update_activity_description` | Write forecast to Strava description |
| `get_athlete_stats` | YTD totals and recent stats |
