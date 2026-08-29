// @effect-diagnostics nodeBuiltinImport:off - offline maintenance script.
/**
 * Apply LLM-generated verbal names to imported jcode threads.
 *
 * Reads a names file (JSON lines: {id, name, topic}) where `id` is the jcode
 * session id (with or without the `session_` prefix), maps it to the same
 * deterministic thread id the importer used, and dispatches a
 * `thread.meta.update` command to rename the thread via the event log so the
 * projection stays authoritative.
 *
 * Usage (offline; stop the desktop app first so sqlite isn't locked):
 *   node apps/server/scripts/rename-jcode-threads.ts --names-file ~/.jcode/knowledge-org/names.jsonl
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as NetService from "@t3tools/shared/Net";

import { CommandId, ThreadId } from "@t3tools/contracts";

import * as ServerConfig from "../src/config.ts";
import { OrchestrationEngineService } from "../src/orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationLayerLive } from "../src/orchestration/runtimeLayer.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../src/persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../src/project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../src/workspace/WorkspacePaths.ts";
import { resolveCliAuthConfig } from "../src/cli/config.ts";

interface NameRecord {
  readonly id: string;
  readonly name: string;
  readonly topic?: string;
}

function parseArgs(argv: ReadonlyArray<string>): { readonly namesFile: string } {
  let namesFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--names-file") namesFile = argv[++i];
  }
  if (!namesFile) throw new Error("--names-file is required");
  return { namesFile };
}

/** Same derivation the importer uses, so ids line up. */
function deterministicThreadId(sessionId: string): string {
  const hash = NodeCrypto.createHash("sha256").update(sessionId).digest("hex");
  const h = hash.slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Importer stores sessions under the raw jcode `id` field (has session_ prefix). */
function normalizeSessionId(id: string): string {
  return id.startsWith("session_") ? id : `session_${id}`;
}

function loadNames(namesFile: string): ReadonlyArray<NameRecord> {
  const text = NodeFS.readFileSync(namesFile, "utf8");
  const out: Array<NameRecord> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as NameRecord;
      if (typeof rec.id === "string" && typeof rec.name === "string" && rec.name.trim()) {
        out.push(rec);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

const program = Effect.gen(function* () {
  const { namesFile } = parseArgs(process.argv.slice(2));
  const names = loadNames(namesFile);
  yield* Console.log(`[rename-jcode] ${names.length} name(s) loaded from ${namesFile}.`);

  const engine = yield* OrchestrationEngineService;

  let renamed = 0;
  let failed = 0;

  for (const rec of names) {
    const sessionId = normalizeSessionId(rec.id);
    const threadId = ThreadId.make(deterministicThreadId(sessionId));
    const title = rec.name.trim().slice(0, 200);
    const commandId = CommandId.make(deterministicThreadId(`rename:${sessionId}:${title}`));

    const result = yield* engine
      .dispatch({
        type: "thread.meta.update",
        commandId,
        threadId,
        title,
      } as never)
      .pipe(Effect.result);

    if (result._tag === "Failure") failed++;
    else renamed++;
  }

  yield* Console.log(`[rename-jcode] done. renamed=${renamed} failed=${failed}.`);
});

const main = Effect.gen(function* () {
  const resolvedConfig = yield* resolveCliAuthConfig(
    { baseDir: Option.none(), devUrl: Option.none() },
    Option.none(),
  );

  const runtimeLayer = Layer.mergeAll(
    WorkspacePaths.layer,
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
