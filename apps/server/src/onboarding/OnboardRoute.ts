// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Voice-note onboarding route: the crux of the 30-minute promise.
 *
 * A stranger records one rambling brain-dump. This route turns it into a
 * proposed team they can review, then writes the two files the app already
 * renders from:
 *
 *   POST /api/onboard/brain-dump  { text }
 *     -> extract fronts (one LLM one-shot) -> assemble -> return
 *        { roster, nowMd, items, existing } for REVIEW. Writes nothing.
 *
 *   POST /api/onboard/commit      { roster, nowMd }
 *     -> writes roster.json + NOW.md, so the Team rail lights up with the new
 *        employees and their real escalations.
 *
 * Existing-user safety (never clobber Aayu's live instance by accident): commit
 * refuses to overwrite an existing roster.json unless `replace: true` is set. On
 * a machine that already has a roster it instead writes roster.json.new and
 * returns { staged: true }, so the UI can show a diff-style confirm before the
 * user explicitly replaces. The brain-dump preview reports `existing` so the UI
 * knows to route through Re-onboard rather than first-run.
 *
 * Paths mirror TodayRoute's env-overridable pattern so this works on a remote
 * box, and it writes to the SAME roster.json TodayRoute reads.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { assembleOnboarding, type RosterEntry } from "@t3tools/shared/onboarding";

import { extractFronts, ExtractionError, MAX_TRANSCRIPT_CHARS } from "./extractFronts.ts";

const ROSTER_JSON_PATH =
  process.env.T3CODE_ROSTER_JSON ?? NodePath.join(NodeOS.homedir(), ".t3/superapp/roster.json");
const NOW_MD_PATH =
  process.env.T3CODE_NOW_MD ?? NodePath.join(NodeOS.homedir(), ".jcode/knowledge-org/NOW.md");

/** True when this instance already has a roster on disk (an existing user). */
function rosterExists(): boolean {
  try {
    return NodeFS.statSync(ROSTER_JSON_PATH).size > 0;
  } catch {
    return false;
  }
}

/** Write a file atomically (temp + rename) so a crash never leaves a half file. */
function writeAtomic(filePath: string, contents: string): void {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  NodeFS.writeFileSync(tmp, contents, "utf8");
  NodeFS.renameSync(tmp, filePath);
}

/** Map an ExtractionError stage to an HTTP status and a user-facing message. */
function extractionFailure(error: ExtractionError): { status: number; detail: string } {
  switch (error.stage) {
    case "empty":
      return { status: 400, detail: "Say a little about what's on your plate first." };
    case "cli-missing":
      return {
        status: 503,
        detail:
          "No AI model is set up on this machine yet. Connect one, or paste an already-organized list.",
      };
    case "spawn":
      return { status: 502, detail: "The model didn't respond. Try again in a moment." };
    case "parse":
      return {
        status: 422,
        detail: "Couldn't read that into a plan. Try again, or edit the list yourself.",
      };
  }
}

/**
 * POST /api/onboard/brain-dump — extract + assemble for review. Writes nothing.
 * The heavy LLM call runs in Effect.tryPromise so its failure is typed, not a
 * thrown 500.
 */
export const onboardBrainDumpRouteLayer = HttpRouter.add(
  "POST",
  "/api/onboard/brain-dump",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orElseSucceed(request.json, () => ({}) as unknown);
    const text =
      typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text : "";
    if (text.trim().length === 0) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "Tell me everything on your plate first." },
        { status: 400 },
      );
    }
    if (text.length > MAX_TRANSCRIPT_CHARS * 2) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "That's a lot of text — trim it to the essentials." },
        { status: 413 },
      );
    }

    const result = yield* Effect.tryPromise({
      try: () => extractFronts(text),
      catch: (error) =>
        error instanceof ExtractionError ? error : new ExtractionError(String(error), "spawn"),
    }).pipe(Effect.either);

    if (result._tag === "Left") {
      const { status, detail } = extractionFailure(result.left);
      return HttpServerResponse.jsonUnsafe({ ok: false, detail }, { status });
    }

    const assembled = assembleOnboarding(result.right);
    return HttpServerResponse.jsonUnsafe({
      ok: true,
      roster: assembled.roster,
      nowMd: assembled.nowMd,
      items: assembled.items,
      existing: rosterExists(),
    });
  }),
);

/** Validate an untrusted roster payload from the client before writing it. */
function validateRosterPayload(raw: unknown): ReadonlyArray<RosterEntry> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Array<RosterEntry> = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const role = typeof e.role === "string" ? e.role.trim() : "";
    if (id.length === 0 || name.length === 0 || role.length === 0) return null;
    if (ids.has(id)) return null;
    ids.add(id);
    const keywords = Array.isArray(e.keywords)
      ? e.keywords.filter((k): k is string => typeof k === "string")
      : [];
    const topics = Array.isArray(e.topics)
      ? e.topics.filter((t): t is string => typeof t === "string")
      : [id];
    out.push({ id, name, role, keywords, topics: topics.length > 0 ? topics : [id] });
  }
  return out;
}

/** Test seam: the payload guard is the one piece of the route worth unit-testing
 * in isolation, since it is what stands between an untrusted client body and a
 * disk write. Exported under an explicit name so the route's public surface
 * stays the two HTTP layers. */
export const validateRosterPayloadForTest = validateRosterPayload;

/**
 * POST /api/onboard/commit — write the roster + NOW.md.
 *
 * Safety: on an instance that already has a roster, the default write is STAGED
 * (roster.json.new) so the live team is never replaced without an explicit
 * `replace: true`. First-run (no roster) writes straight through.
 */
export const onboardCommitRouteLayer = HttpRouter.add(
  "POST",
  "/api/onboard/commit",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orElseSucceed(request.json, () => ({}) as unknown);
    const b = (body ?? {}) as { roster?: unknown; nowMd?: unknown; replace?: unknown };

    const roster = validateRosterPayload(b.roster);
    if (roster === null) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "The team is empty or malformed — add at least one employee." },
        { status: 400 },
      );
    }
    const nowMd = typeof b.nowMd === "string" ? b.nowMd : "";
    if (nowMd.trim().length === 0) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "Nothing to escalate yet." },
        { status: 400 },
      );
    }
    const rosterText = `${JSON.stringify(roster, null, 2)}\n`;
    const replace = b.replace === true;
    const existing = rosterExists();

    const write = yield* Effect.try({
      try: () => {
        if (existing && !replace) {
          // Never clobber a live instance implicitly: stage the new roster next
          // to the old so the UI can diff, and hold the NOW.md write until the
          // user confirms the replace (NOW.md is not a hardcoded life like the
          // roster is, but staging both keeps the confirm atomic).
          writeAtomic(`${ROSTER_JSON_PATH}.new`, rosterText);
          writeAtomic(`${NOW_MD_PATH}.new`, nowMd);
          return { staged: true as const };
        }
        writeAtomic(ROSTER_JSON_PATH, rosterText);
        writeAtomic(NOW_MD_PATH, nowMd);
        // A confirmed replace clears any stale staged files.
        for (const p of [`${ROSTER_JSON_PATH}.new`, `${NOW_MD_PATH}.new`]) {
          try {
            NodeFS.rmSync(p);
          } catch {
            /* nothing staged */
          }
        }
        return { staged: false as const };
      },
      catch: (error) => new Error(`could not write onboarding files: ${String(error)}`),
    }).pipe(Effect.either);

    if (write._tag === "Left") {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "Couldn't save your team. Check the server's disk and permissions." },
        { status: 500 },
      );
    }

    return HttpServerResponse.jsonUnsafe({
      ok: true,
      staged: write.right.staged,
      rosterPath: write.right.staged ? `${ROSTER_JSON_PATH}.new` : ROSTER_JSON_PATH,
      employees: roster.length,
    });
  }),
);
