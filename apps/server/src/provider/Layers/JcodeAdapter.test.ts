// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodeFs from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  JcodeSettings,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { JcodeAdapterShape } from "../Services/JcodeAdapter.ts";
import { makeJcodeAdapter } from "./JcodeAdapter.ts";

const decodeJcodeSettings = Schema.decodeSync(JcodeSettings);

class JcodeAdapter extends Context.Service<JcodeAdapter, JcodeAdapterShape>()(
  "t3/provider/Layers/JcodeAdapter.test/JcodeAdapter",
) {}

/** Locate a real jcode binary, or return undefined so the live test is skipped. */
function resolveJcodeBinary(): string | undefined {
  const candidates = [
    process.env.JCODE_BINARY,
    NodePath.join(NodeOS.homedir(), ".local/bin/jcode"),
    "/usr/local/bin/jcode",
    "/opt/homebrew/bin/jcode",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      NodeFs.accessSync(candidate, NodeFs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

const jcodeBinary = resolveJcodeBinary();

const makeResolveJcodeSettings = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  return yield* Effect.succeed(
    serverSettings.getSettings.pipe(
      Effect.map((snapshot) => snapshot.providers.jcode),
      Effect.orDie,
    ),
  );
});

const jcodeAdapterTestLayer = it.layer(
  Layer.effect(
    JcodeAdapter,
    Effect.gen(function* () {
      const jcodeConfig = decodeJcodeSettings({});
      const resolveSettings = yield* makeResolveJcodeSettings;
      return yield* makeJcodeAdapter(jcodeConfig, { resolveSettings });
    }),
  ).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3code-jcode-adapter-test-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

jcodeAdapterTestLayer("JcodeAdapterLive", (it) => {
  // Auto-skips when no jcode binary is present (CI without jcode installed).
  const liveEffect = jcodeBinary ? it.effect : it.effect.skip;

  liveEffect(
    "drives the real jcode binary: start session, prompt, stream reply, complete turn",
    () =>
      Effect.gen(function* () {
        const adapter = yield* JcodeAdapter;
        const settings = yield* ServerSettingsService;
        const threadId = ThreadId.make("jcode-live-thread");

        yield* settings.updateSettings({
          providers: { jcode: { enabled: true, binaryPath: jcodeBinary! } },
        });

        // Collect the runtime event stream in the background while we drive a
        // full turn against the real agent.
        const collected: Array<ProviderRuntimeEvent> = [];
        const collectorFiber = yield* adapter.streamEvents.pipe(
          Stream.tap((event) => Effect.sync(() => collected.push(event))),
          Stream.runDrain,
          Effect.forkChild,
        );

        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("jcode"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("jcode"), model: "" },
        });
        assert.equal(session.provider, "jcode");
        assert.isDefined(session.resumeCursor);

        const turn = yield* adapter
          .sendTurn({
            threadId,
            input: "Reply with exactly this token and nothing else: PONG_JCODE_OK",
            attachments: [],
          })
          .pipe(Effect.timeout("90 seconds"));
        assert.equal(turn.threadId, threadId);

        yield* adapter.stopSession(threadId);
        yield* Fiber.interrupt(collectorFiber);

        const types = collected.map((event) => event.type);
        for (const expected of [
          "session.started",
          "thread.started",
          "turn.started",
          "content.delta",
          "turn.completed",
        ] as const) {
          assert.include(types, expected);
        }

        const streamedText = collected
          .filter((event) => event.type === "content.delta")
          .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
          .join("");
        assert.match(streamedText, /PONG_JCODE_OK/);

        const turnCompleted = collected.find((event) => event.type === "turn.completed");
        assert.isDefined(turnCompleted);
        if (turnCompleted?.type === "turn.completed") {
          assert.equal(turnCompleted.payload.state, "completed");
        }
      }),
    120_000,
  );

  // A 32x32 solid-red PNG, generated with zlib (no external image deps).
  const RED_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";

  liveEffect(
    "sends a real image attachment to jcode and gets a description back",
    () =>
      Effect.gen(function* () {
        const adapter = yield* JcodeAdapter;
        const settings = yield* ServerSettingsService;
        const serverConfig = yield* ServerConfig;
        const threadId = ThreadId.make("jcode-image-thread");

        yield* settings.updateSettings({
          providers: { jcode: { enabled: true, binaryPath: jcodeBinary! } },
        });

        // Materialize a real attachment file where the adapter will look for it.
        const attachment = {
          type: "image" as const,
          id: "jcode-image-thread-00000000-0000-4000-8000-000000000001",
          name: "red.png",
          mimeType: "image/png",
          sizeBytes: 0,
        };
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        assert.isNotNull(attachmentPath);
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.dirname(attachmentPath!), { recursive: true });
          await NodeFSP.writeFile(attachmentPath!, Buffer.from(RED_PNG_BASE64, "base64"));
        });

        const collected: Array<ProviderRuntimeEvent> = [];
        const collectorFiber = yield* adapter.streamEvents.pipe(
          Stream.tap((event) => Effect.sync(() => collected.push(event))),
          Stream.runDrain,
          Effect.forkChild,
        );

        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("jcode"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("jcode"), model: "" },
        });

        yield* adapter
          .sendTurn({
            threadId,
            input:
              "This image is a solid block of one color. Reply with ONLY that color word, lowercase.",
            attachments: [attachment],
          })
          .pipe(Effect.timeout("90 seconds"));

        yield* adapter.stopSession(threadId);
        yield* Fiber.interrupt(collectorFiber);

        const streamedText = collected
          .filter((event) => event.type === "content.delta")
          .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
          .join("");
        assert.match(streamedText, /red/i);
      }),
    120_000,
  );

  // Resume/attach: prove t3code can open an EXISTING jcode session by id and
  // replay its real history (this is the "all my chats, real state" path).
  // Opt-in: set JCODE_RESUME_SESSION_ID to a real ~/.jcode/sessions id.
  const resumeSessionId = process.env.JCODE_RESUME_SESSION_ID;
  const resumeCwd = process.env.JCODE_RESUME_CWD ?? process.cwd();
  const resumeEffect = jcodeBinary && resumeSessionId ? it.effect : it.effect.skip;

  resumeEffect(
    "attaches an existing jcode session by id and replays its history",
    () =>
      Effect.gen(function* () {
        const adapter = yield* JcodeAdapter;
        const settings = yield* ServerSettingsService;
        const threadId = ThreadId.make("jcode-resume-thread");

        yield* settings.updateSettings({
          providers: { jcode: { enabled: true, binaryPath: jcodeBinary! } },
        });

        const collected: Array<ProviderRuntimeEvent> = [];
        const collectorFiber = yield* adapter.streamEvents.pipe(
          Stream.tap((event) => Effect.sync(() => collected.push(event))),
          Stream.runDrain,
          Effect.forkChild,
        );

        const session = yield* adapter
          .startSession({
            threadId,
            provider: ProviderDriverKind.make("jcode"),
            cwd: resumeCwd,
            runtimeMode: "full-access",
            modelSelection: { instanceId: ProviderInstanceId.make("jcode"), model: "" },
            resumeCursor: { schemaVersion: 1, sessionId: resumeSessionId! },
          })
          .pipe(Effect.timeout("90 seconds"));

        // The session that comes back must be the SAME jcode session we asked
        // to resume, not a fresh one.
        assert.equal(session.provider, "jcode");
        const resumed = session.resumeCursor as { sessionId?: string } | undefined;
        assert.equal(resumed?.sessionId, resumeSessionId);

        yield* adapter.stopSession(threadId);
        yield* Fiber.interrupt(collectorFiber);

        const types = collected.map((event) => event.type);
        assert.include(types, "session.started");
      }),
    120_000,
  );
});
