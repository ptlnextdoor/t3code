/**
 * JcodeAcpSupport — spawn + runtime helpers for the jcode ACP CLI (`jcode acp`).
 *
 * jcode is a local agent binary. Unlike Cursor it advertises an empty
 * `authMethods` array and rejects the ACP `authenticate` call (`-32601`), so
 * we pass `authMethodId: undefined` and `AcpSessionRuntime` skips authenticate
 * per spec. Model selection uses the standard ACP `session/set_model` /
 * `configOptions` mechanism rather than a Cursor-style extension method.
 *
 * @module provider/acp/JcodeAcpSupport
 */
import { type JcodeSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type JcodeAcpRuntimeSettings = Pick<JcodeSettings, "binaryPath" | "launchArgs">;

export interface JcodeAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly jcodeSettings: JcodeAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

/** Split the free-form `launchArgs` string into individual CLI tokens. */
function parseLaunchArgs(launchArgs: string | null | undefined): ReadonlyArray<string> {
  return (launchArgs ?? "")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function buildJcodeAcpSpawnInput(
  jcodeSettings: JcodeAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: jcodeSettings?.binaryPath || "jcode",
    args: [...parseLaunchArgs(jcodeSettings?.launchArgs), "acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeJcodeAcpRuntime = (
  input: JcodeAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildJcodeAcpSpawnInput(input.jcodeSettings, input.cwd, input.environment),
        // jcode advertises no auth methods and rejects `authenticate`. Omit
        // `authMethodId` entirely so the runtime skips the call (ACP
        // spec-correct); exactOptionalPropertyTypes forbids passing undefined.
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });
