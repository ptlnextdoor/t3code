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
/** Cap payloads: t3code perf rule, no large payloads to the client. */
const MAX_CARDS = 30;
const MAX_NOW_BYTES = 64 * 1024;

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
  readonly nowMarkdown: string | null;
  readonly cards: ReadonlyArray<TodayTimelineCard>;
  readonly dayflowAvailable: boolean;
}

function readNowMarkdown(): string | null {
  try {
    const stat = NodeFS.statSync(NOW_MD_PATH);
    if (stat.size > MAX_NOW_BYTES) {
      return NodeFS.readFileSync(NOW_MD_PATH, "utf8").slice(0, MAX_NOW_BYTES);
    }
    return NodeFS.readFileSync(NOW_MD_PATH, "utf8");
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

export function buildTodayPayload(): TodayPayload {
  const { cards, available } = readTodayCards();
  return {
    generatedAt: new Date().toISOString(),
    nowMarkdown: readNowMarkdown(),
    cards,
    dayflowAvailable: available,
  };
}

export const todayRouteLayer = HttpRouter.add(
  "GET",
  "/api/today",
  Effect.sync(() =>
    HttpServerResponse.jsonUnsafe(buildTodayPayload(), {
      headers: { "Cache-Control": "private, max-age=60" },
    }),
  ),
);
