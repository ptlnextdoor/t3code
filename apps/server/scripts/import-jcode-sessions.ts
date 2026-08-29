// @effect-diagnostics nodeBuiltinImport:off - offline maintenance script.
/**
 * Import existing jcode CLI sessions (~/.jcode/sessions/*.json) into T3 Code
 * as threads that LIVE-ATTACH to the real jcode session on open.
 *
 * For each jcode session we:
 *   1. dispatch a `thread.create` command (so the thread appears in the list),
 *   2. upsert a `provider_session_runtime` row carrying the jcode session id as
 *      the resume cursor, so opening the thread issues ACP `session/load` and
 *      replays the real history (see JcodeAdapter + AcpSessionRuntime).
 *
 * This does NOT copy message content into T3's event log — jcode stays the
 * source of truth. The thread is a live handle onto the real session.
 *
 * Usage (offline; stop the desktop app first so sqlite isn't locked):
 *   node apps/server/scripts/import-jcode-sessions.ts --limit 1        # tracer
 *   node apps/server/scripts/import-jcode-sessions.ts --min-messages 2 # real run
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as NetService from "@t3tools/shared/Net";

import { CommandId, ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";

import * as ServerConfig from "../src/config.ts";
import { OrchestrationEngineService } from "../src/orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationLayerLive } from "../src/orchestration/runtimeLayer.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../src/persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepository } from "../src/persistence/ProviderSessionRuntime.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../src/persistence/Layers/ProviderSessionRuntime.ts";
import * as RepositoryIdentityResolver from "../src/project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../src/workspace/WorkspacePaths.ts";
import { resolveCliAuthConfig } from "../src/cli/config.ts";

const JCODE_PROJECT_ID = ProjectId.make("1a62d856-2fbe-4ebe-9e20-028fa85fca11");
const JCODE_INSTANCE = ProviderInstanceId.make("jcode");
const JCODE_PROVIDER = "jcode";

interface JcodeSessionFile {
  readonly id: string;
  readonly title: string | null;
  readonly short_name?: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly working_dir?: string;
  readonly model?: string;
  readonly provider_key?: string;
  readonly messages?: ReadonlyArray<unknown>;
  readonly status?: string;
}

interface CliOptions {
  readonly limit: number | undefined;
  readonly minMessages: number;
  readonly session: string | undefined;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let limit: number | undefined;
  let minMessages = 2;
  let session: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") limit = Number.parseInt(argv[++i] ?? "", 10);
    else if (arg === "--min-messages") minMessages = Number.parseInt(argv[++i] ?? "2", 10);
    else if (arg === "--session") session = argv[++i];
  }
  return { limit, minMessages, session };
}

/** Load candidate jcode sessions, newest first. */
function loadCandidates(options: CliOptions): ReadonlyArray<JcodeSessionFile> {
  const dir = NodePath.join(NodeOS.homedir(), ".jcode", "sessions");
  const entries = NodeFS.readdirSync(dir)
    .filter((name) => name.startsWith("session_") && name.endsWith(".json"))
    .map((name) => {
      const full = NodePath.join(dir, name);
      let mtime = 0;
      try {
        mtime = NodeFS.statSync(full).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const out: Array<JcodeSessionFile> = [];
  for (const entry of entries) {
    let parsed: JcodeSessionFile;
    try {
      parsed = JSON.parse(NodeFS.readFileSync(entry.full, "utf8")) as JcodeSessionFile;
    } catch {
      continue;
    }
    if (typeof parsed.id !== "string" || !parsed.id) continue;
    if (options.session && parsed.id !== options.session) continue;
    const messageCount = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
    if (!options.session && messageCount < options.minMessages) continue;
    out.push(parsed);
    if (options.limit !== undefined && out.length >= options.limit) break;
  }
  return out;
}

function threadTitle(session: JcodeSessionFile): string {
  const raw = (session.title ?? session.short_name ?? session.id).trim();
  return raw.length > 0 ? raw.slice(0, 200) : session.id;
}

/**
 * jcode session ids are stable and unique, so derive a deterministic thread
 * UUID from the session id. Re-running the importer is then idempotent: the
 * same session maps to the same thread and `thread.create` is a no-op.
 */
function deterministicThreadId(sessionId: string): string {
  const hash = NodeCrypto.createHash("sha256").update(sessionId).digest("hex");
  // Format 32 hex chars as a v4-shaped UUID (version/variant nibbles fixed).
  const h = hash.slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const program = Effect.gen(function* () {
  const options = parseArgs(process.argv.slice(2));
  const candidates = loadCandidates(options);
  yield* Console.log(
    `[import-jcode] ${candidates.length} candidate session(s) (limit=${options.limit ?? "none"}, minMessages=${options.minMessages}).`,
  );

  const engine = yield* OrchestrationEngineService;
  const runtimeRepo = yield* ProviderSessionRuntimeRepository;

  let created = 0;
  let bound = 0;
  let skipped = 0;

  for (const session of candidates) {
    const threadId = ThreadId.make(deterministicThreadId(session.id));
    const createdAt = session.created_at ?? session.updated_at ?? "2020-01-01T00:00:00.000Z";
    const commandId = CommandId.make(deterministicThreadId(`create:${session.id}`));

    const dispatchResult = yield* engine
      .dispatch({
        type: "thread.create",
        commandId,
        threadId,
        projectId: JCODE_PROJECT_ID,
        title: threadTitle(session),
        modelSelection: { instanceId: JCODE_INSTANCE, model: session.model ?? "" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: session.working_dir ?? NodeOS.homedir(),
        createdAt,
      } as never)
      .pipe(Effect.result);

    if (dispatchResult._tag === "Failure") {
      // Most likely the thread already exists (idempotent re-run). Still (re)bind.
      skipped++;
    } else {
      created++;
    }

    // Bind the resume cursor so opening the thread live-attaches via session/load.
    yield* runtimeRepo.upsert({
      threadId,
      providerName: JCODE_PROVIDER,
      providerInstanceId: JCODE_INSTANCE,
      adapterKey: JCODE_PROVIDER,
      runtimeMode: "full-access",
      status: "stopped",
      lastSeenAt: session.updated_at ?? createdAt,
      resumeCursor: { schemaVersion: 1, sessionId: session.id },
      runtimePayload: session.working_dir ? { cwd: session.working_dir } : null,
    });
    bound++;
  }

  yield* Console.log(
    `[import-jcode] done. created=${created} rebound=${skipped} boundResumeCursors=${bound}.`,
  );
});

const main = Effect.gen(function* () {
  const resolvedConfig = yield* resolveCliAuthConfig(
    { baseDir: Option.none(), devUrl: Option.none() },
    Option.none(),
  );

  const runtimeLayer = Layer.mergeAll(
    WorkspacePaths.layer,
    ProviderSessionRuntimeRepositoryLive,
    OrchestrationLayerLive.pipe(Layer.provideMerge(RepositoryIdentityResolver.layer)),
  ).pipe(
    Layer.provideMerge(SqlitePersistenceLayerLive),
    Layer.provide(ServerConfig.layer(resolvedConfig)),
    Layer.provide(NetService.layer),
    Layer.provide(NodeServices.layer),
    Layer.provide(Layer.succeed(References.MinimumLogLevel, resolvedConfig.logLevel)),
  );

  yield* program.pipe(Effect.provide(runtimeLayer));
}).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)));

NodeRuntime.runMain(main);
