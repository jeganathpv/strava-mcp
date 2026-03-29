/**
 * Fitness Coach MCP Server — Cloudflare Workers
 * Connects Claude to Strava API via MCP protocol
 * Tools: get_latest_activity, get_activity_detail,
 *        get_week_activities, update_activity_description, get_athlete_stats
 */

import { McpAgent } from "agents/mcp";                              // ✅ correct package
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Env {
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REFRESH_TOKEN: string;
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  start_date_local: string;
  moving_time: number;
  distance: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
  average_watts?: number;
  average_cadence?: number;
  suffer_score?: number;
  calories?: number;
  total_elevation_gain?: number;
  description?: string;
  pool_length?: number;
  average_stroke_count?: number;
  laps?: StravaLap[];
}

interface StravaLap {
  average_speed?: number;
  average_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  elapsed_time?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STRAVA_BASE = "https://www.strava.com/api/v3";

async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: env.STRAVA_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function stravaGet(path: string, params: Record<string, string | number>, env: Env): Promise<unknown> {
  const token = await getAccessToken(env);
  const url = new URL(`${STRAVA_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava API error: ${res.status} ${path}`);
  return res.json();
}

function formatPace(avgSpeedMs: number): string {
  if (!avgSpeedMs) return "—";
  const secPerKm = 1000 / avgSpeedMs;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /km`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function mapActivityType(stravaType: string): string {
  const map: Record<string, string> = {
    Run:            "Run",
    TrailRun:       "OCR",       // Trail runs → OCR category
    Hike:           "Hike",      // ✅ Hike is its own type now
    WeightTraining: "Gym",
    Workout:        "Gym",
    Crossfit:       "Gym",
    Swim:           "Swimming",
    Ride:           "Ride",
  };
  // ✅ Unknown types fall back to the raw Strava type string
  return map[stravaType] ?? stravaType;
}

function buildSplits(laps: StravaLap[]) {
  return laps.map((lap, i) => ({
    km:      i + 1,
    pace:    lap.average_speed ? formatPace(lap.average_speed) : "—",
    hr:      lap.average_heartrate ?? "—",
    cadence: lap.average_cadence ? Math.round(lap.average_cadence * 2) : "—",
    power:   lap.average_watts ?? "—",
    elapsed: formatDuration(lap.elapsed_time ?? 0),
  }));
}

function activitySummary(act: StravaActivity) {
  return {
    id:              act.id,
    name:            act.name,
    type:            mapActivityType(act.type),
    raw_strava_type: act.type,
    date:            act.start_date_local?.slice(0, 10),
    duration:        formatDuration(act.moving_time ?? 0),
    distance_km:     act.distance ? +(act.distance / 1000).toFixed(2) : "—",
    avg_hr:          act.average_heartrate ?? "—",
    max_hr:          act.max_heartrate ?? "—",
    avg_pace:        act.average_speed ? formatPace(act.average_speed) : "—",
    avg_power:       act.average_watts ?? "—",
    relative_effort: act.suffer_score ?? "—",
    calories:        act.calories ?? "—",
    elevation_m:     act.total_elevation_gain ?? "—",
  };
}

// ── MCP Agent ─────────────────────────────────────────────────────────────────
export class FitnessMCP extends McpAgent<Env> {
  server = new McpServer({ name: "fitness-coach", version: "1.0.0" });

  async init() {
    const env = this.env;

    // ── Tool: get_latest_activity ─────────────────────────────────────────
    this.server.tool(
      "get_latest_activity",
      "Fetch the most recent Strava activity, optionally filtered by date (YYYY-MM-DD) and type (Run | Gym | Swimming | OCR | Hike | Cooldown).",
      { date: z.string().optional(), activity_type: z.string().optional() },
      async ({ date, activity_type }) => {
        const targetDate = date ? new Date(date) : new Date();
        const after  = Math.floor(new Date(targetDate.toDateString()).getTime() / 1000);
        const before = after + 86399;

        const activities = await stravaGet(
          "/athlete/activities",
          { after, before, per_page: 30 },
          env
        ) as StravaActivity[];

        let filtered = activities;
        if (activity_type) {
          const typeMap: Record<string, string[]> = {
            run:      ["Run"],
            gym:      ["WeightTraining", "Workout", "Crossfit"],
            swimming: ["Swim"],
            ocr:      ["TrailRun"],
            hike:     ["Hike"],           // ✅ Hike filter
            cooldown: ["Run"],
          };
          const allowed = typeMap[activity_type.toLowerCase()] ?? [activity_type];
          filtered = activities.filter(a => allowed.includes(a.type));
        }

        if (!filtered.length) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "No matching activity found for this date/type." }),
            }],
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(activitySummary(filtered[0]), null, 2) }] };
      }
    );

    // ── Tool: get_activity_detail ─────────────────────────────────────────
    this.server.tool(
      "get_activity_detail",
      "Get full detail for a specific Strava activity by ID — splits, laps, HR zones, power.",
      { activity_id: z.string() },
      async ({ activity_id }) => {
        const act  = await stravaGet(`/activities/${activity_id}`, {}, env) as StravaActivity;
        const type = mapActivityType(act.type);

        const result: Record<string, unknown> = {
          ...activitySummary(act),
          description: act.description ?? "",
        };

        if (type === "Run" || type === "OCR") {
          result.splits_per_km = buildSplits(act.laps ?? []);
          result.avg_cadence   = act.average_cadence
            ? Math.round(act.average_cadence * 2) : "—";

        } else if (type === "Swimming") {
          result.pool_length_m = act.pool_length ?? "—";
          result.strokes       = act.average_stroke_count ?? "—";
          result.splits        = buildSplits(act.laps ?? []);

        } else if (type === "Hike") {
          // Hike: elevation + pace per segment are the key metrics
          result.splits = buildSplits(act.laps ?? []);

        } else {
          // ✅ Unknown / new activity type — return all raw Strava fields
          // Claude reads this and auto-creates a new Notion template
          result.raw_strava_data = {
            moving_time:  act.moving_time,
            distance_km:  act.distance ? +(act.distance / 1000).toFixed(2) : null,
            avg_speed_ms: act.average_speed ?? null,
            avg_hr:       act.average_heartrate ?? null,
            max_hr:       act.max_heartrate ?? null,
            avg_watts:    act.average_watts ?? null,
            avg_cadence:  act.average_cadence ?? null,
            suffer_score: act.suffer_score ?? null,
            calories:     act.calories ?? null,
            elevation_m:  act.total_elevation_gain ?? null,
            laps:         act.laps ?? [],
          };
          result.note =
            `New activity type detected: "${act.type}". ` +
            `Use raw_strava_data to build a new Notion template for this activity. ` +
            `Once created, always follow the same template for "${act.type}" in future sessions.`;
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );

    // ── Tool: get_week_activities ─────────────────────────────────────────
    this.server.tool(
      "get_week_activities",
      "Fetch all activities for the Monday–Sunday week containing the given date (defaults to today).",
      { date: z.string().optional() },
      async ({ date }) => {
        const ref    = date ? new Date(date) : new Date();
        const day    = ref.getDay();
        const monday = new Date(ref);
        monday.setDate(ref.getDate() - ((day + 6) % 7));
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 0);

        const after  = Math.floor(monday.getTime() / 1000);
        const before = Math.floor(sunday.getTime() / 1000);

        const activities = await stravaGet(
          "/athlete/activities",
          { after, before, per_page: 50 },
          env
        ) as StravaActivity[];

        const fmt = (d: Date) =>
          d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              week:       `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`,
              total:      activities.length,
              activities: activities.map(activitySummary),
            }, null, 2),
          }],
        };
      }
    );

    // ── Tool: update_activity_description ────────────────────────────────
    this.server.tool(
      "update_activity_description",
      "Update the description of a Strava activity (writes forecast summary back to Strava).",
      { activity_id: z.string(), description: z.string() },
      async ({ activity_id, description }) => {
        const token = await getAccessToken(env);
        const res = await fetch(`${STRAVA_BASE}/activities/${activity_id}`, {
          method: "PUT",
          headers: {
            Authorization:  `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description }),
        });
        if (!res.ok) throw new Error(`Update failed: ${res.status}`);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ status: "updated", activity_id }),
          }],
        };
      }
    );

    // ── Tool: get_athlete_stats ───────────────────────────────────────────
    this.server.tool(
      "get_athlete_stats",
      "Fetch overall athlete stats — YTD totals, recent run/ride summaries.",
      {},
      async () => {
        const athlete = await stravaGet("/athlete", {}, env) as {
          id: number; firstname: string; lastname: string;
        };
        const stats = await stravaGet(`/athletes/${athlete.id}/stats`, {}, env) as {
          ytd_run_totals:    { distance: number; count: number };
          ytd_ride_totals:   { distance: number };
          recent_run_totals: { distance: number; count: number };
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name:                   `${athlete.firstname} ${athlete.lastname}`,
              ytd_run_distance_km:    +(stats.ytd_run_totals.distance / 1000).toFixed(1),
              ytd_run_count:          stats.ytd_run_totals.count,
              ytd_ride_distance_km:   +(stats.ytd_ride_totals.distance / 1000).toFixed(1),
              recent_run_distance_km: +(stats.recent_run_totals.distance / 1000).toFixed(1),
              recent_run_count:       stats.recent_run_totals.count,
            }, null, 2),
          }],
        };
      }
    );
  }
}

// ── Worker Entry Point ────────────────────────────────────────────────────────
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", server: "fitness-coach-mcp" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return FitnessMCP.serve("/mcp").fetch(request, env, ctx);
  },
};