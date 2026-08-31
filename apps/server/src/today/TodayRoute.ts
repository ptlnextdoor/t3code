// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * TODAY panel data route. Read-only bridge over two local sources:
 *  - Dayflow's chunks.sqlite (screen-activity timeline cards)
 *  - ~/.jcode/knowledge-org/NOW.md (what-needs-you command center)
 *
 * Hard rule (SUPERAPP-PLAN.md): never write to Dayflow's DB. The connection is
 * opened readonly per-request and closed immediately; no long-lived handle so
 * Dayflow's own writer is never contended.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { upcomingCalendarEvents, type CalendarEvent } from "../connections/CalendarActions.ts";

/*
 * Paths are overridable so the server can run on a remote box (a VPS, a second
 * machine) while its inputs live wherever they actually are: synced into the
 * container, mounted, or pushed from the laptop. Hardcoding homedir() made the
 * server silently return an empty command centre anywhere but this Mac.
 */
const DAYFLOW_DB_PATH =
  process.env.T3CODE_DAYFLOW_DB ??
  NodePath.join(NodeOS.homedir(), "Library/Application Support/Dayflow/chunks.sqlite");
const NOW_MD_PATH =
  process.env.T3CODE_NOW_MD ?? NodePath.join(NodeOS.homedir(), ".jcode/knowledge-org/NOW.md");
/**
 * Per-instance employee roster. Absent on the original instance, which falls
 * back to the built-in default baked into the web bundle, so nothing changes
 * here. A stranger drops a roster.json to staff their own team without a code
 * change. Path is env-overridable to match T3CODE_NOW_MD's pattern.
 */
const ROSTER_JSON_PATH =
  process.env.T3CODE_ROSTER_JSON ?? NodePath.join(NodeOS.homedir(), ".t3/superapp/roster.json");
/** Cap payloads: t3code perf rule, no large payloads to the client. */
const MAX_CARDS = 30;
const MAX_NOW_BYTES = 64 * 1024;
/** A roster.json larger than this is a mistake, not a team. Cap defensively. */
const MAX_ROSTER_BYTES = 32 * 1024;

export interface TodayTimelineCard {
  readonly day: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly category: string;
  readonly subcategory: string | null;
}

export interface TodayPayload {
  readonly generatedAt: string;
  /**
   * ISO mtime of NOW.md, the age of the underlying briefing (distinct from
   * `generatedAt`, which is when this response was built). Null when the file
   * is missing. L5 renders staleness > 24h as a visible notice (gap G1).
   */
  readonly nowGeneratedAt: string | null;
  readonly nowMarkdown: string | null;
  /**
   * Raw roster.json read off disk, or null when the instance has no override.
   * The client validates and falls back to the built-in default, so the wire
   * stays a dumb passthrough and the original instance sends null.
   */
  readonly rosterJson: string | null;
  readonly cards: ReadonlyArray<TodayTimelineCard>;
  readonly dayflowAvailable: boolean;
  /**
   * Upcoming calendar events, next 7 days, title+start+allday only (house rule
   * on payload size). Empty when Calendar is not connected, so the client just
   * renders nothing rather than a broken section.
   */
  readonly calendar: ReadonlyArray<CalendarEvent>;
}

function readNow(): { markdown: string | null; generatedAt: string | null } {
  try {
    const stat = NodeFS.statSync(NOW_MD_PATH);
    const raw = NodeFS.readFileSync(NOW_MD_PATH, "utf8");
    const markdown = stat.size > MAX_NOW_BYTES ? raw.slice(0, MAX_NOW_BYTES) : raw;
    return { generatedAt: stat.mtime.toISOString(), markdown };
  } catch {
    return { generatedAt: null, markdown: null };
  }
}

/**
 * Read the raw roster.json off disk, or null when there is no override file.
 * Only ever returns the raw text: validation lives on the client (parseRoster),
 * so the server stays a dumb file bridge. Oversized files are dropped rather
 * than truncated, since a half-JSON blob would just fail to parse anyway.
 */
function readRosterJson(): string | null {
  try {
    const stat = NodeFS.statSync(ROSTER_JSON_PATH);
    if (stat.size > MAX_ROSTER_BYTES) return null;
    return NodeFS.readFileSync(ROSTER_JSON_PATH, "utf8");
  } catch {
    return null;
  }
}

function readTodayCards(): { cards: Array<TodayTimelineCard>; available: boolean } {
  let db: NodeSqlite.DatabaseSync | undefined;
  try {
    db = new NodeSqlite.DatabaseSync(DAYFLOW_DB_PATH, { readOnly: true });
    const localDay = new Date().toLocaleDateString("en-CA");
    const rows = db
      .prepare(
        `SELECT day, start, end, title, category, subcategory
           FROM timeline_cards
          WHERE is_deleted = 0 AND day = ?
          ORDER BY start_ts DESC
          LIMIT ?`,
      )
      .all(localDay, MAX_CARDS) as unknown as Array<TodayTimelineCard>;
    return { cards: rows, available: true };
  } catch {
    return { cards: [], available: false };
  } finally {
    db?.close();
  }
}

export async function buildTodayPayload(): Promise<TodayPayload> {
  const { cards, available } = readTodayCards();
  const now = readNow();
  // Calendar is a network read and may be absent; it must never block or fail
  // the rest of the briefing, so it resolves to [] on any trouble.
  const calendar = await upcomingCalendarEvents().catch(() => [] as Array<CalendarEvent>);
  return {
    generatedAt: new Date().toISOString(),
    nowGeneratedAt: now.generatedAt,
    nowMarkdown: now.markdown,
    rosterJson: readRosterJson(),
    cards,
    dayflowAvailable: available,
    calendar,
  };
}

export const todayRouteLayer = HttpRouter.add(
  "GET",
  "/api/today",
  Effect.promise(async () =>
    HttpServerResponse.jsonUnsafe(await buildTodayPayload(), {
      headers: { "Cache-Control": "private, max-age=60" },
    }),
  ),
);
