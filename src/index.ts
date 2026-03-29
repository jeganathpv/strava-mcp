import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REFRESH_TOKEN: string;
}

interface StravaActivity {
  id: number; name: string; type: string; start_date_local: string;
  moving_time: number; distance: number; average_heartrate?: number;
  max_heartrate?: number; average_speed?: number; average_watts?: number;
  average_cadence?: number; suffer_score?: number; calories?: number;
  total_elevation_gain?: number; description?: string;
  pool_length?: number; average_stroke_count?: number; laps?: StravaLap[];
}

interface StravaLap {
  average_speed?: number; average_heartrate?: number;
  average_cadence?: number; average_watts?: number; elapsed_time?: number;
}

const STRAVA_BASE = "https://www.strava.com/api/v3";

async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: env.STRAVA_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function stravaGet(path: string, params: Record<string, string | number>, env: Env) {
  const token = await getAccessToken(env);
  const url = new URL(`${STRAVA_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Strava error: ${res.status} ${path}`);
  return res.json();
}

function formatPace(s: number) {
  if (!s) return "—";
  const spk = 1000 / s, m = Math.floor(spk / 60), sec = Math.round(spk % 60);
  return `${m}:${sec.toString().padStart(2, "0")} /km`;
}
function formatDuration(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}
function mapType(t: string) {
  return ({ Run:"Run", TrailRun:"OCR", Hike:"Hike", WeightTraining:"Gym",
    Workout:"Gym", Crossfit:"Gym", Swim:"Swimming", Ride:"Ride" } as Record<string,string>)[t] ?? t;
}
function splits(laps: StravaLap[]) {
  return laps.map((l, i) => ({
    km: i+1, pace: l.average_speed ? formatPace(l.average_speed) : "—",
    hr: l.average_heartrate ?? "—",
    cadence: l.average_cadence ? Math.round(l.average_cadence * 2) : "—",
    power: l.average_watts ?? "—", elapsed: formatDuration(l.elapsed_time ?? 0),
  }));
}
function summary(a: StravaActivity) {
  return {
    id: a.id, name: a.name, type: mapType(a.type), raw_strava_type: a.type,
    date: a.start_date_local?.slice(0,10), duration: formatDuration(a.moving_time ?? 0),
    distance_km: a.distance ? +(a.distance/1000).toFixed(2) : "—",
    avg_hr: a.average_heartrate ?? "—", max_hr: a.max_heartrate ?? "—",
    avg_pace: a.average_speed ? formatPace(a.average_speed) : "—",
    avg_power: a.average_watts ?? "—", relative_effort: a.suffer_score ?? "—",
    calories: a.calories ?? "—", elevation_m: a.total_elevation_gain ?? "—",
  };
}

function registerTools(server: McpServer, env: Env) {
  server.registerTool("get_latest_activity",
    { description: "Fetch most recent Strava activity. Filter by date (YYYY-MM-DD) and/or type (Run|Gym|Swimming|OCR|Hike|Cooldown).",
      inputSchema: { date: z.string().optional(), activity_type: z.string().optional() } },
    async ({ date, activity_type }) => {
      const d = date ? new Date(date) : new Date();
      const after = Math.floor(new Date(d.toDateString()).getTime()/1000);
      const acts = await stravaGet("/athlete/activities", { after, before: after+86399, per_page: 30 }, env) as StravaActivity[];
      let filtered = acts;
      if (activity_type) {
        const m: Record<string,string[]> = { run:["Run"], gym:["WeightTraining","Workout","Crossfit"],
          swimming:["Swim"], ocr:["TrailRun"], hike:["Hike"], cooldown:["Run"] };
        const allowed = m[activity_type.toLowerCase()] ?? [activity_type];
        filtered = acts.filter(a => allowed.includes(a.type));
      }
      if (!filtered.length) return { content:[{type:"text" as const, text: JSON.stringify({error:"No matching activity found."})}] };
      return { content:[{type:"text" as const, text: JSON.stringify(summary(filtered[0]), null, 2)}] };
    }
  );

  server.registerTool("get_activity_detail",
    { description: "Get full Strava activity detail by ID — splits, HR, power, cadence.",
      inputSchema: { activity_id: z.string() } },
    async ({ activity_id }) => {
      const act = await stravaGet(`/activities/${activity_id}`, {}, env) as StravaActivity;
      const type = mapType(act.type);
      const result: Record<string,unknown> = { ...summary(act), description: act.description ?? "" };
      if (type==="Run"||type==="OCR") {
        result.splits_per_km = splits(act.laps??[]);
        result.avg_cadence = act.average_cadence ? Math.round(act.average_cadence*2) : "—";
      } else if (type==="Swimming") {
        result.pool_length_m = act.pool_length ?? "—";
        result.strokes = act.average_stroke_count ?? "—";
        result.splits = splits(act.laps??[]);
      } else if (type==="Hike") {
        result.splits = splits(act.laps??[]);
      } else {
        result.raw_strava_data = {
          moving_time: act.moving_time, distance_km: act.distance ? +(act.distance/1000).toFixed(2) : null,
          avg_speed_ms: act.average_speed??null, avg_hr: act.average_heartrate??null,
          max_hr: act.max_heartrate??null, avg_watts: act.average_watts??null,
          avg_cadence: act.average_cadence??null, suffer_score: act.suffer_score??null,
          calories: act.calories??null, elevation_m: act.total_elevation_gain??null, laps: act.laps??[],
        };
        result.note = `New activity type: "${act.type}". Build a new Notion template from raw_strava_data. Stick to it for future "${act.type}" sessions.`;
      }
      return { content:[{type:"text" as const, text: JSON.stringify(result, null, 2)}] };
    }
  );

  server.registerTool("get_week_activities",
    { description: "All Strava activities for the Mon–Sun week of the given date (default today).",
      inputSchema: { date: z.string().optional() } },
    async ({ date }) => {
      const ref = date ? new Date(date) : new Date();
      const mon = new Date(ref); mon.setDate(ref.getDate()-((ref.getDay()+6)%7)); mon.setHours(0,0,0,0);
      const sun = new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,0);
      const acts = await stravaGet("/athlete/activities",
        { after: Math.floor(mon.getTime()/1000), before: Math.floor(sun.getTime()/1000), per_page: 50 }, env
      ) as StravaActivity[];
      const fmt = (d: Date) => d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
      return { content:[{type:"text" as const, text: JSON.stringify({
        week: `${fmt(mon)} – ${fmt(sun)} ${sun.getFullYear()}`,
        total: acts.length, activities: acts.map(summary),
      }, null, 2)}] };
    }
  );

  server.registerTool("update_activity_description",
    { description: "Update a Strava activity description (write forecast summary back).",
      inputSchema: { activity_id: z.string(), description: z.string() } },
    async ({ activity_id, description }) => {
      const token = await getAccessToken(env);
      const res = await fetch(`${STRAVA_BASE}/activities/${activity_id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      return { content:[{type:"text" as const, text: JSON.stringify({status:"updated", activity_id})}] };
    }
  );

  server.registerTool("get_athlete_stats",
    { description: "YTD and recent run/ride stats for the athlete." },
    async () => {
      const a = await stravaGet("/athlete", {}, env) as { id:number; firstname:string; lastname:string };
      const s = await stravaGet(`/athletes/${a.id}/stats`, {}, env) as {
        ytd_run_totals:{distance:number;count:number}; ytd_ride_totals:{distance:number};
        recent_run_totals:{distance:number;count:number};
      };
      return { content:[{type:"text" as const, text: JSON.stringify({
        name: `${a.firstname} ${a.lastname}`,
        ytd_run_distance_km: +(s.ytd_run_totals.distance/1000).toFixed(1),
        ytd_run_count: s.ytd_run_totals.count,
        ytd_ride_distance_km: +(s.ytd_ride_totals.distance/1000).toFixed(1),
        recent_run_distance_km: +(s.recent_run_totals.distance/1000).toFixed(1),
        recent_run_count: s.recent_run_totals.count,
      }, null, 2)}] };
    }
  );
}

// ── MCP Agent ─────────────────────────────────────────────────────────────────
export class FitnessMCP extends McpAgent<Env> {
  server = new McpServer({ name: "fitness-coach", version: "1.0.0" });
  async init() { registerTools(this.server, this.env); }
}

// ── Worker Entry Point ────────────────────────────────────────────────────────
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return FitnessMCP.serveSSE("/sse", { binding: "FitnessMCP" }).fetch(request, env, ctx);
    }

    return FitnessMCP.serve("/mcp", { binding: "FitnessMCP" }).fetch(request, env, ctx);
  },
};
