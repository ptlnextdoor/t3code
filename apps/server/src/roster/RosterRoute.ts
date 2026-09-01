// @effect-diagnostics nodeBuiltinImport:off globalDate:off preferSchemaOverJson:off
/**
 * HIRE route: append one employee to the instance's roster.json (N3.9).
 *
 *   POST /api/roster/employee  { id, name, role, keywords?, topics?, host? }
 *     -> validate, append to the existing roster (or start a fresh one when no
 *        file exists yet), atomically write, and return the full roster so the
 *        client can render the new hire immediately.
 *
 * This is the write half of the "I can create my own bot" acceptance loop. It
 * OWNS the file the same way OnboardRoute/commit does: same env-overridable
 * path (T3CODE_ROSTER_JSON), same atomic temp+rename, so a stranger, a laptop,
 * and a Hetzner box all hire into the file TodayRoute already reads.
 *
 * Unlike /api/onboard/commit (which REPLACES the whole team from the wizard),
 * this APPENDS a single employee, so it never needs the staged-replace dance:
 * adding a person is additive and safe. It refuses a duplicate id rather than
 * clobbering an existing employee, which is the one way an append could lose
 * data.
 *
 * Guarding: like the sibling superapp routes, this is an unauthenticated local
 * file bridge. It is only reachable on a server the client is already paired
 * to (the HTTP surface sits behind the same origin/pairing the rest of
 * /api/* does), and it only ever writes the superapp roster file, never
 * anything in the orchestration database.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { RosterEntry } from "@t3tools/shared/onboarding";

const ROSTER_JSON_PATH =
  process.env.T3CODE_ROSTER_JSON ?? NodePath.join(NodeOS.homedir(), ".t3/superapp/roster.json");

/** A roster.json larger than this is a mistake, not a team. Cap defensively. */
const MAX_ROSTER_BYTES = 32 * 1024;
/** A single hire longer than this is a paste accident. Cap each free-text field. */
const MAX_FIELD_CHARS = 400;
/** More keywords than this is not a routing hint, it is noise. */
const MAX_KEYWORDS = 40;

/** Write a file atomically (temp + rename) so a crash never leaves a half file. */
function writeAtomic(filePath: string, contents: string): void {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  NodeFS.writeFileSync(tmp, contents, "utf8");
  NodeFS.renameSync(tmp, filePath);
}

/**
 * Read the current roster off disk as an array, or [] when there is no file yet
 * (first hire on a fresh instance) or the file is unreadable/oversized. A
 * malformed existing file is a real problem — appending to a `[]` we invented
 * would silently drop the user's team — so this THROWS on a present-but-corrupt
 * file and the caller turns that into a 500 rather than data loss.
 */
function readExistingRoster(): Array<RosterEntry> {
  let raw: string;
  try {
    const stat = NodeFS.statSync(ROSTER_JSON_PATH);
    if (stat.size === 0) return [];
    if (stat.size > MAX_ROSTER_BYTES) {
      throw new Error("existing roster.json is too large to safely append to");
    }
    raw = NodeFS.readFileSync(ROSTER_JSON_PATH, "utf8");
  } catch (error) {
    // ENOENT: no roster yet, start fresh. Anything else (including the size
    // guard above) is a genuine failure the caller must surface, not swallow.
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("existing roster.json is not an array");
  return parsed as Array<RosterEntry>;
}

/**
 * Validate ONE untrusted employee payload from the client. Returns the cleaned
 * entry, or null with a human reason. Kept a pure function (exported for unit
 * tests) so the guard between the wire and disk is provable without a server.
 */
export function validateEmployeePayload(
  raw: unknown,
): { ok: true; entry: RosterEntry } | { ok: false; detail: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, detail: "Expected an employee object." };
  }
  const e = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const id = str(e.id);
  const name = str(e.name);
  const role = str(e.role);
  if (id.length === 0) return { ok: false, detail: "An employee needs an id." };
  if (name.length === 0) return { ok: false, detail: "Give your employee a name." };
  if (role.length === 0) return { ok: false, detail: "Say in one line what they own." };
  if (
    id.length > MAX_FIELD_CHARS ||
    name.length > MAX_FIELD_CHARS ||
    role.length > MAX_FIELD_CHARS
  ) {
    return { ok: false, detail: "That's too long for a name or role." };
  }
  // Keywords/topics are optional routing hints: drop non-strings rather than
  // rejecting the whole hire over one bad chip. Topics default to [id] so the
  // employee owns its own namespace, matching the onboarding assembler.
  const keywords = Array.isArray(e.keywords)
    ? e.keywords
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0)
        .slice(0, MAX_KEYWORDS)
    : [];
  const topicsRaw = Array.isArray(e.topics)
    ? e.topics
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];
  const topics = topicsRaw.length > 0 ? topicsRaw : [id];
  const host = str(e.host);
  if (e.host !== undefined && e.host !== null && typeof e.host !== "string") {
    return { ok: false, detail: "Host must be an environment id." };
  }
  const entry: RosterEntry = {
    id,
    name,
    role,
    keywords,
    topics,
    // Only bind a host when a real (non-empty) one was given; blank / "local"
    // stays absent so the client treats it as This Mac.
    ...(host.length > 0 && host !== "local" ? { host } : {}),
  };
  return { ok: true, entry };
}

/**
 * POST /api/roster/employee — append one employee. The whole decision (read,
 * dup-check, append, write) runs inside a single Effect.sync returning a
 * discriminated outcome, so a disk failure or a corrupt existing file becomes a
 * fail-closed HTTP value rather than a thrown effect.
 */
export const rosterEmployeeRouteLayer = HttpRouter.add(
  "POST",
  "/api/roster/employee",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orElseSucceed(request.json, () => ({}) as unknown);
    const validation = validateEmployeePayload(body);
    if (!validation.ok) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: validation.detail },
        { status: 400 },
      );
    }
    const entry = validation.entry;

    const outcome = yield* Effect.sync(
      ():
        | { kind: "ok"; roster: ReadonlyArray<RosterEntry> }
        | { kind: "duplicate" }
        | { kind: "error" } => {
        try {
          const roster = readExistingRoster();
          if (roster.some((existing) => existing.id === entry.id)) {
            return { kind: "duplicate" };
          }
          const next = [...roster, entry];
          writeAtomic(ROSTER_JSON_PATH, `${JSON.stringify(next, null, 2)}\n`);
          return { kind: "ok", roster: next };
        } catch {
          return { kind: "error" };
        }
      },
    );

    if (outcome.kind === "duplicate") {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: `An employee with id "${entry.id}" already exists.` },
        { status: 409 },
      );
    }
    if (outcome.kind === "error") {
      return HttpServerResponse.jsonUnsafe(
        {
          ok: false,
          detail: "Couldn't save your employee. Check the server's disk and roster file.",
        },
        { status: 500 },
      );
    }
    return HttpServerResponse.jsonUnsafe({
      ok: true,
      employee: entry,
      roster: outcome.roster,
      rosterPath: ROSTER_JSON_PATH,
    });
  }),
);
