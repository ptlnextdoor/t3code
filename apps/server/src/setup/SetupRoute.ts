// @effect-diagnostics nodeBuiltinImport:off globalDate:off preferSchemaOverJson:off
/**
 * Setup wizard route: the small server surface behind the first-run wizard.
 *
 * The wizard is a ribbon over machinery that already has its own routes
 * (/api/connections/*, /api/onboard/*). This file adds only what those did not
 * already cover: the local identity file and the first-run signal.
 *
 *   GET  /api/setup/state    -> { firstRun, profilePresent, rosterPresent, name }
 *     Reports whether profile.json and roster.json exist so the client can
 *     decide, from a single source of truth, whether to auto-show the wizard.
 *
 *   POST /api/setup/profile  { name }
 *     Writes ~/.t3/superapp/profile.json {name}. Local-first identity: no cloud
 *     signup, no tokens, just the user's name so the app can address them. The
 *     name is trimmed and length-capped; anything else is rejected before it
 *     touches disk.
 *
 * Paths mirror the roster's env-overridable pattern (T3CODE_PROFILE_JSON /
 * T3CODE_ROSTER_JSON) so the wizard works on a remote box, and it writes to the
 * SAME profile.json the rest of the app will read.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

const PROFILE_JSON_PATH = () =>
  process.env.T3CODE_PROFILE_JSON ?? NodePath.join(NodeOS.homedir(), ".t3/superapp/profile.json");
const ROSTER_JSON_PATH = () =>
  process.env.T3CODE_ROSTER_JSON ?? NodePath.join(NodeOS.homedir(), ".t3/superapp/roster.json");

/** A name longer than this is a paste accident, not a name. Cap defensively. */
export const MAX_NAME_CHARS = 120;

/** True when a non-empty file exists at `filePath`. */
function fileHasContent(filePath: string): boolean {
  try {
    return NodeFS.statSync(filePath).size > 0;
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

export interface SetupProfile {
  readonly name: string;
}

/**
 * Read the stored profile name, or null when absent/unreadable. Kept tiny and
 * defensive: a malformed profile.json must not crash the state route.
 */
export function readProfileName(): string | null {
  try {
    const raw = NodeFS.readFileSync(PROFILE_JSON_PATH(), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}

/**
 * Validate a submitted name. Returns the trimmed name, or null when it is not a
 * usable name (empty, not a string, or over the cap). Exported for unit tests so
 * the guard is provable without a running server.
 */
export function validateNameForTest(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_NAME_CHARS) return null;
  return trimmed;
}

export interface SetupState {
  readonly firstRun: boolean;
  readonly profilePresent: boolean;
  readonly rosterPresent: boolean;
  readonly name: string | null;
  /** True when a remote box is already reachable (env flag or ssh alias). */
  readonly remoteReady: boolean;
}

/**
 * Detect whether a remote is already set up, so step 3 can show Connected
 * instead of teaching the provisioning command. Two honest signals, both facts
 * about THIS machine, never a guess: the explicit T3CODE_REMOTE_READY env, or a
 * `Host t3code` alias in the user's ~/.ssh/config (how t3code_remote was wired).
 * We only READ ssh config; we never shell out or connect.
 */
export function remoteReady(): boolean {
  if (process.env.T3CODE_REMOTE_READY === "1" || process.env.T3CODE_REMOTE_READY === "true") {
    return true;
  }
  try {
    const sshConfig = NodeFS.readFileSync(NodePath.join(NodeOS.homedir(), ".ssh/config"), "utf8");
    // A "Host t3code" / "Host t3code-box" line means the alias exists.
    return /^\s*Host\s+.*\bt3code\b/im.test(sshConfig);
  } catch {
    return false;
  }
}

/**
 * Compute the first-run state from disk. First run is BOTH files absent, the
 * same rule the client's pure logic enforces, kept in lockstep so the server
 * and client never disagree about whether to auto-show the wizard.
 */
export function computeSetupState(): SetupState {
  const profilePresent = fileHasContent(PROFILE_JSON_PATH());
  const rosterPresent = fileHasContent(ROSTER_JSON_PATH());
  return {
    firstRun: !profilePresent && !rosterPresent,
    profilePresent,
    rosterPresent,
    name: readProfileName(),
    remoteReady: remoteReady(),
  };
}

/** GET /api/setup/state — the single source of truth for first-run detection. */
export const setupStateRouteLayer = HttpRouter.add(
  "GET",
  "/api/setup/state",
  Effect.sync(() => HttpServerResponse.jsonUnsafe(computeSetupState())),
);

/** POST /api/setup/profile — write local-first identity. Fail-closed on bad input. */
export const setupProfileRouteLayer = HttpRouter.add(
  "POST",
  "/api/setup/profile",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orElseSucceed(request.json, () => ({}) as unknown);
    const name = validateNameForTest((body as { name?: unknown })?.name);
    if (name === null) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "Tell me your name so I know who I'm working for." },
        { status: 400 },
      );
    }
    // writeAtomic is synchronous; a plain try/catch keeps the handler a
    // fail-closed value rather than a thrown 500, matching OnboardRoute.
    try {
      writeAtomic(PROFILE_JSON_PATH(), `${JSON.stringify({ name }, null, 2)}\n`);
      return HttpServerResponse.jsonUnsafe({ ok: true, name });
    } catch {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "Couldn't save your profile. Check the server can write to disk." },
        { status: 500 },
      );
    }
  }),
);
