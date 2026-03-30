import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Env {
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REFRESH_TOKEN: string;
}

interface SplitMetric {
  split: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_speed: number;
  average_grade_adjusted_speed?: number;
  average_heartrate?: number;
  elevation_difference?: number;
  pace_zone?: number;
}

interface SegmentEffort {
  name: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  pr_rank?: number | null;
  segment?: { name: string; distance: number; average_grade: number; city?: string };
}

interface BestEffort {
  name: string;
  elapsed_time: number;
  distance: number;
  pr_rank?: number | null;
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date_local: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
  max_speed?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  kilojoules?: number;
  average_cadence?: number;
  suffer_score?: number;
  calories?: number;
  total_elevation_gain?: number;
  elev_high?: number;
  elev_low?: number;
  description?: string;
  pool_length?: number;
  pr_count?: number;
  laps?: StravaLap[];
  splits_metric?: SplitMetric[];
  segment_efforts?: SegmentEffort[];
  best_efforts?: BestEffort[];
  gear?: { name: string; distance: number };
}

interface StravaLap {
  lap_index?: number;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  average_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  total_elevation_gain?: number;
  pace_zone?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function formatPace(s: number): string {
  if (!s) return "—";
  const spk = 1000 / s, m = Math.floor(spk / 60), sec = Math.round(spk % 60);
  return `${m}:${sec.toString().padStart(2, "0")} /km`;
}

function formatSwimPace(s: number): string {
  if (!s) return "—";
  const spp = 100 / s, m = Math.floor(spp / 60), sec = Math.round(spp % 60);
  return `${m}:${sec.toString().padStart(2, "0")} /100m`;
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}

// sport_type is more specific than type (e.g. Badminton vs Workout)
function mapType(type: string, sportType: string): string {
  const map: Record<string, string> = {
    Run: "Run", TrailRun: "OCR", Hike: "Hike",
    WeightTraining: "Gym", Workout: "Gym", Crossfit: "Gym",
    Swim: "Swimming", Ride: "Ride",
  };
  return map[sportType] ?? map[type] ?? sportType ?? type;
}

function summary(a: StravaActivity) {
  return {
    id:              a.id,
    name:            a.name,
    type:            mapType(a.type, a.sport_type),
    sport_type:      a.sport_type,
    date:            a.start_date_local?.slice(0, 10),
    duration:        formatDuration(a.moving_time ?? 0),
    distance_km:     a.distance ? +(a.distance / 1000).toFixed(2) : "—",
    avg_hr:          a.average_heartrate ?? "—",
    max_hr:          a.max_heartrate ?? "—",
    avg_pace:        a.average_speed ? formatPace(a.average_speed) : "—",
    avg_power:       a.average_watts ?? "—",
    relative_effort: a.suffer_score ?? "—",
    calories:        a.calories ?? "—",
    elevation_m:     a.total_elevation_gain ?? "—",
  };
}

function buildSplitsMetric(splits: SplitMetric[]) {
  return splits.map(s => ({
    km:          s.split,
    distance_m:  Math.round(s.distance),
    pace:        formatPace(s.average_speed),
    gap:         s.average_grade_adjusted_speed ? formatPace(s.average_grade_adjusted_speed) : "—",
    hr:          s.average_heartrate ? Math.round(s.average_heartrate) : "—",
    elev_diff_m: s.elevation_difference ?? "—",
    pace_zone:   s.pace_zone ?? "—",
  }));
}

function buildIntervalLaps(laps: StravaLap[]) {
  return laps.map(l => ({
    lap:    l.lap_index ?? "—",
    time:   formatDuration(l.elapsed_time ?? 0),
    dist_m: l.distance ? +l.distance.toFixed(0) : "—",
    pace:   l.average_speed ? formatPace(l.average_speed) : "—",
    hr:     l.average_heartrate ?? "—",
    power:  l.average_watts ?? "—",
    zone:   l.pace_zone ?? "—",
  }));
}

function buildSegments(efforts: SegmentEffort[]) {
  return efforts.map(e => ({
    name:    e.name,
    dist_km: +(e.distance / 1000).toFixed(2),
    time:    formatDuration(e.elapsed_time),
    pace:    e.moving_time && e.distance ? formatPace(e.distance / e.moving_time) : "—",
    hr:      e.average_heartrate ?? "—",
    power:   e.average_watts ?? "—",
    pr_rank: e.pr_rank ?? null,
    grade:   e.segment?.average_grade ?? "—",
  }));
}

function buildBestEfforts(efforts: BestEffort[]) {
  return efforts.map(e => ({
    distance: e.name,
    time:     formatDuration(e.elapsed_time),
    pr_rank:  e.pr_rank ?? null,
  }));
}

function buildSwimLaps(laps: StravaLap[]) {
  return laps
    .filter(l => (l.distance ?? 0) > 0)
    .map(l => ({
      lap:    l.lap_index ?? "—",
      dist_m: l.distance ?? "—",
      time:   formatDuration(l.elapsed_time ?? 0),
      pace:   l.average_speed ? formatSwimPace(l.average_speed) : "—",
      hr:     l.average_heartrate ?? "—",
    }));
}

// ── Tools ─────────────────────────────────────────────────────────────────────
function registerTools(server: McpServer, env: Env) {
  server.registerTool("get_latest_activity",
    { description: "Fetch most recent Strava activity. Filter by date (YYYY-MM-DD) and/or type (Run|Gym|Swimming|OCR|Hike|Cooldown).",
      inputSchema: { date: z.string().optional(), activity_type: z.string().optional() } },
    async ({ date, activity_type }) => {
      const d = date ? new Date(date) : new Date();
      const after = Math.floor(new Date(d.toDateString()).getTime() / 1000);
      const acts = await stravaGet("/athlete/activities", { after, before: after + 86399, per_page: 30 }, env) as StravaActivity[];
      let filtered = acts;
      if (activity_type) {
        const m: Record<string, string[]> = {
          run: ["Run"], gym: ["WeightTraining", "Workout", "Crossfit"],
          swimming: ["Swim"], ocr: ["TrailRun"], hike: ["Hike"], cooldown: ["Run"],
        };
        const allowed = m[activity_type.toLowerCase()] ?? [activity_type];
        filtered = acts.filter(a => allowed.includes(a.type) || allowed.includes(a.sport_type));
      }
      if (!filtered.length) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No matching activity found." }) }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary(filtered[0]), null, 2) }] };
    }
  );

  server.registerTool("get_activity_detail",
    { description: "Get full Strava activity detail by ID — splits per km, interval laps, named segments, best efforts, gear.",
      inputSchema: { activity_id: z.string() } },
    async ({ activity_id }) => {
      const act = await stravaGet(`/activities/${activity_id}`, {}, env) as StravaActivity;
      const type = mapType(act.type, act.sport_type);
      const result: Record<string, unknown> = { ...summary(act), description: act.description ?? "" };

      if (type === "Run" || type === "OCR") {
        result.max_speed_pace  = act.max_speed ? formatPace(act.max_speed) : "—";
        result.weighted_power  = act.weighted_average_watts ?? "—";
        result.kilojoules      = act.kilojoules ?? "—";
        result.elev_high_m     = act.elev_high ?? "—";
        result.elev_low_m      = act.elev_low ?? "—";
        result.pr_count        = act.pr_count ?? 0;
        result.avg_cadence     = act.average_cadence ? Math.round(act.average_cadence * 2) : "—";
        result.gear            = act.gear ? `${act.gear.name} (${Math.round(act.gear.distance / 1000)}km)` : "—";
        result.splits_per_km   = buildSplitsMetric(act.splits_metric ?? []);
        if ((act.laps?.length ?? 0) > 1) {
          result.interval_laps = buildIntervalLaps(act.laps!);
        }
        result.segments        = buildSegments(act.segment_efforts ?? []);
        result.best_efforts    = buildBestEfforts(act.best_efforts ?? []);

      } else if (type === "Swimming") {
        result.pace_per_100m   = act.average_speed ? formatSwimPace(act.average_speed) : "—";
        result.total_distance_m = act.distance ?? "—";
        result.pool_length_m   = act.pool_length ?? "—";
        result.pool_laps       = buildSwimLaps(act.laps ?? []);

      } else if (type === "Hike") {
        result.elev_high_m     = act.elev_high ?? "—";
        result.elev_low_m      = act.elev_low ?? "—";
        result.elapsed_time    = formatDuration(act.elapsed_time ?? 0);
        result.splits_per_km   = buildSplitsMetric(act.splits_metric ?? []);

      } else if (type === "Gym") {
        result.elapsed_time    = formatDuration(act.elapsed_time ?? 0);

      } else {
        result.raw_strava_data = {
          sport_type: act.sport_type, moving_time: act.moving_time,
          distance_km: act.distance ? +(act.distance / 1000).toFixed(2) : null,
          avg_hr: act.average_heartrate ?? null, max_hr: act.max_heartrate ?? null,
          calories: act.calories ?? null, suffer_score: act.suffer_score ?? null,
        };
        result.note = `Activity type "${act.sport_type}" — raw data returned. Build a Notion template from this for future "${act.sport_type}" sessions.`;
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool("get_week_activities",
    { description: "All Strava activities for the Mon–Sun week of the given date (default today).",
      inputSchema: { date: z.string().optional() } },
    async ({ date }) => {
      const ref = date ? new Date(date) : new Date();
      const mon = new Date(ref); mon.setDate(ref.getDate() - ((ref.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 0);
      const acts = await stravaGet("/athlete/activities",
        { after: Math.floor(mon.getTime() / 1000), before: Math.floor(sun.getTime() / 1000), per_page: 50 }, env
      ) as StravaActivity[];
      const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          week: `${fmt(mon)} – ${fmt(sun)} ${sun.getFullYear()}`,
          total: acts.length,
          activities: acts.map(summary),
        }, null, 2) }],
      };
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
      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "updated", activity_id }) }] };
    }
  );

  server.registerTool("get_athlete_stats",
    { description: "YTD and recent run/ride stats for the athlete." },
    async () => {
      const a = await stravaGet("/athlete", {}, env) as { id: number; firstname: string; lastname: string };
      const s = await stravaGet(`/athletes/${a.id}/stats`, {}, env) as {
        ytd_run_totals: { distance: number; count: number };
        ytd_ride_totals: { distance: number };
        recent_run_totals: { distance: number; count: number };
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          name:                   `${a.firstname} ${a.lastname}`,
          ytd_run_distance_km:    +(s.ytd_run_totals.distance / 1000).toFixed(1),
          ytd_run_count:          s.ytd_run_totals.count,
          ytd_ride_distance_km:   +(s.ytd_ride_totals.distance / 1000).toFixed(1),
          recent_run_distance_km: +(s.recent_run_totals.distance / 1000).toFixed(1),
          recent_run_count:       s.recent_run_totals.count,
        }, null, 2) }],
      };
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
