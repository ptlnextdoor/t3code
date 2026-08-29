/**
 * JcodeProvider — status probe + snapshot builders for the jcode ACP CLI.
 *
 * Adapted from {@link ./CursorProvider}, but far smaller: jcode needs no CLI
 * login, no subscription parsing, and no Cursor `list_available_models`
 * extension. The probe is:
 *   1. binary present + `jcode version --json` succeeds → installed + version,
 *   2. ACP handshake (`initialize → session/new`) succeeds → ready, and the
 *      `model` config option's values become the model catalog.
 *
 * @module provider/Layers/JcodeProvider
 */
import type {
  JcodeSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { HttpClient } from "effect/unstable/http";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  collectStreamAsString,
  isCommandMissingCause,
  providerModelsFromSettings,
  type CommandResult,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  collectSessionConfigOptionValues,
  findSessionConfigOption,
} from "../acp/AcpRuntimeModel.ts";
import { buildJcodeAcpSpawnInput } from "../acp/JcodeAcpSupport.ts";

const JCODE_PRESENTATION = {
  displayName: "jcode",
  badgeLabel: "Local",
  showInteractionModeToggle: false,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const JCODE_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const VERSION_TIMEOUT_MS = 8_000;

export function getJcodeFallbackModels(
  jcodeSettings: Pick<JcodeSettings, "customModels">,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings([], jcodeSettings.customModels, EMPTY_CAPABILITIES);
}

export function buildInitialJcodeProviderSnapshot(
  jcodeSettings: JcodeSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = getJcodeFallbackModels(jcodeSettings);
    if (!jcodeSettings.enabled) {
      return buildServerProvider({
        presentation: JCODE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "jcode is disabled in T3 Code settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: JCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking jcode availability...",
      },
    });
  });
}

interface JcodeVersionResult {
  readonly version: string | null;
}

/** Parse `jcode version --json` output; falls back to null version. */
export function parseJcodeVersion(result: CommandResult): JcodeVersionResult {
  const trimmed = result.stdout.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { version?: unknown; semver?: unknown };
      const raw =
        typeof parsed.version === "string"
          ? parsed.version
          : typeof parsed.semver === "string"
            ? parsed.semver
            : null;
      return { version: raw ? raw.trim() : null };
    } catch {
      // fall through to plain parsing
    }
  }
  const match = trimmed.match(/v?\d+\.\d+\.\d+[^\s]*/);
  return { version: match ? match[0] : null };
}

const runJcodeCommand = (
  jcodeSettings: JcodeSettings,
  args: ReadonlyArray<string>,
  environment?: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawnCommand = yield* resolveSpawnCommand(
      jcodeSettings.binaryPath,
      args,
      environment ? { env: environment } : {},
    );
    const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      ...(environment ? { env: environment } : { extendEnv: true }),
      shell: spawnCommand.shell,
    });
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

/**
 * Discover jcode models by running an ACP handshake and reading the `model`
 * config option returned by `session/new`.
 */
const discoverJcodeModelsViaAcp = (jcodeSettings: JcodeSettings, environment?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        spawn: buildJcodeAcpSpawnInput(jcodeSettings, process.cwd(), environment),
        cwd: process.cwd(),
        clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
        // jcode rejects `authenticate`; omit authMethodId so it is skipped.
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner))),
    );
    const acp = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    yield* acp.start();
    const configOptions = yield* acp.getConfigOptions;
    const modelOption =
      findSessionConfigOption(configOptions, "model") ??
      configOptions.find((option) => option.category === "model");
    if (!modelOption) {
      return [] as ReadonlyArray<ServerProviderModel>;
    }
    const seen = new Set<string>();
    const models: Array<ServerProviderModel> = [];
    for (const value of collectSessionConfigOptionValues(modelOption)) {
      const slug = value.trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      models.push({ slug, name: slug, isCustom: false, capabilities: EMPTY_CAPABILITIES });
    }
    return models as ReadonlyArray<ServerProviderModel>;
  }).pipe(Effect.scoped);

function buildJcodeCliCommandMissingMessage(binaryPath: string): string {
  return [
    `jcode command \`${binaryPath}\` was not found.`,
    `Install jcode and make sure \`${binaryPath}\` is on PATH (e.g. \`~/.local/bin/jcode\`), then restart T3 Code.`,
  ].join(" ");
}

export const checkJcodeProviderStatus = Effect.fn("checkJcodeProviderStatus")(function* (
  jcodeSettings: JcodeSettings,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = getJcodeFallbackModels(jcodeSettings);

  if (!jcodeSettings.enabled) {
    return buildServerProvider({
      presentation: JCODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "jcode is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runJcodeCommand(
    jcodeSettings,
    ["version", "--json"],
    environment,
  ).pipe(Effect.timeoutOption(VERSION_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    yield* Effect.logWarning("jcode CLI health check failed.", { errorTag: error._tag });
    return buildServerProvider({
      presentation: JCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? buildJcodeCliCommandMissingMessage(jcodeSettings.binaryPath)
          : "Failed to execute jcode CLI health check.",
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: JCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "jcode is installed but timed out while running `jcode version`.",
      },
    });
  }

  const { version } = parseJcodeVersion(versionProbe.success.value);

  let discoveredModels: ReadonlyArray<ServerProviderModel> = [];
  let discoveryWarning: string | undefined;
  const discoveryExit = yield* Effect.exit(
    discoverJcodeModelsViaAcp(jcodeSettings, environment).pipe(
      Effect.timeoutOption(JCODE_ACP_MODEL_DISCOVERY_TIMEOUT_MS),
    ),
  );
  if (Exit.isFailure(discoveryExit)) {
    yield* Effect.logWarning("jcode ACP model discovery failed", {
      errorTag: causeErrorTag(discoveryExit.cause),
    });
    discoveryWarning = "jcode ACP model discovery failed. Check server logs for ACP details.";
  } else if (Option.isNone(discoveryExit.value)) {
    discoveryWarning = `jcode ACP model discovery timed out after ${JCODE_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`;
  } else {
    discoveredModels = discoveryExit.value.value;
  }

  return buildServerProvider({
    presentation: JCODE_PRESENTATION,
    enabled: true,
    checkedAt,
    models: providerModelsFromSettings(
      discoveredModels,
      jcodeSettings.customModels,
      EMPTY_CAPABILITIES,
    ),
    probe: {
      installed: true,
      version,
      status: discoveryWarning ? "warning" : "ready",
      auth: { status: "authenticated" },
      ...(discoveryWarning ? { message: discoveryWarning } : {}),
    },
  });
});

/**
 * Background maintenance enrichment for a jcode snapshot: republishes version
 * advisory metadata without re-discovering models.
 */
export const enrichJcodeSnapshot = (input: {
  readonly settings: JcodeSettings;
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly stampIdentity?: (snapshot: ServerProvider) => ServerProvider;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { settings, snapshot, publishSnapshot } = input;
  const stampIdentity = input.stampIdentity ?? ((value) => value);
  if (!settings.enabled) {
    return Effect.void;
  }
  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) =>
      publishSnapshot(stampIdentity(enrichedSnapshot)).pipe(Effect.as(enrichedSnapshot)),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("jcode version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }).pipe(Effect.asVoid),
    ),
  );
};
