# Fitness Coach MCP — Cloudflare Workers

Connects Claude to Strava via MCP protocol. Deployed as a Cloudflare Worker with Durable Objects.

---

## Prerequisites

- Node.js 20+ installed
- A Cloudflare account → https://dash.cloudflare.com/sign-up
- A Strava API app → https://www.strava.com/settings/api

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

Opens a browser → log in → authorize Wrangler. One time only.

---

## Step 3 — Get Strava OAuth refresh token

The refresh token must be obtained with the correct scopes: `read`, `activity:read_all`, `activity:write`.

**1. Open this URL in your browser** (replace `YOUR_CLIENT_ID`):
```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=read,activity:read_all,activity:write
```

**2.** After clicking Authorize, the browser redirects to `localhost` (will fail to load — that's fine).
Copy the `code=` value from the URL bar:
```
http://localhost/?state=&code=COPY_THIS&scope=read,activity:read_all,activity:write
```

**3. Exchange the code for tokens:**
```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code
```

Copy the `refresh_token` from the response.

> **Note:** The callback URL in your Strava app settings can stay as `http://localhost` — the Worker never handles OAuth redirects. The refresh token flow is used at runtime, not the callback.

---

## Step 4 — Add Strava secrets to Cloudflare

Run each command and paste the value when prompted:

```bash
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_REFRESH_TOKEN
```

Secrets are stored encrypted in Cloudflare — never in your code.

> **Updating secrets:** If your refresh token expires or you need to re-authorize, just run `npx wrangler secret put STRAVA_REFRESH_TOKEN` again. No redeploy needed.

---

## Step 5 — Deploy

```bash
npm run deploy
```

You'll get a permanent URL:
```
https://fitness-coach-mcp.YOUR-NAME.workers.dev
```

---

## Step 6 — Add to Claude.ai

1. Go to **claude.ai → Settings → Connectors**
2. Click **Add custom connector**
3. Name: `Strava Fitness Coach`
4. URL: `https://fitness-coach-mcp.YOUR-NAME.workers.dev/sse`
5. Click **Add**

> Use the `/sse` endpoint — Claude.ai web requires SSE transport.
> The `/mcp` endpoint (Streamable HTTP) is available for Claude Desktop / Claude Code.

---

## Health Check

```
https://fitness-coach-mcp.YOUR-NAME.workers.dev/health
```

Returns: `{"status":"ok"}`

---

## MCP Tools

| Tool | Scope required | What it does |
|---|---|---|
| `get_latest_activity` | `activity:read_all` | Fetch today's activity, filter by type |
| `get_activity_detail` | `activity:read_all` | Full splits, laps, HR, power by ID |
| `get_week_activities` | `activity:read_all` | All sessions for Mon–Sun week |
| `update_activity_description` | `activity:write` | Write description back to Strava |
| `get_athlete_stats` | `read` | YTD totals and recent stats |

---

## Updating the server

After any code changes:
```bash
npm run deploy
```
