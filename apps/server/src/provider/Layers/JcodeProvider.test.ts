import * as NodeOS from "node:os";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import { JcodeSettings } from "@t3tools/contracts";

import { checkJcodeProviderStatus, parseJcodeVersion } from "./JcodeProvider.ts";
import type { CommandResult } from "../providerSnapshot.ts";

const decodeJcodeSettings = Schema.decodeSync(JcodeSettings);

const runNode = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

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

describe("parseJcodeVersion", () => {
  it("parses `jcode version --json` JSON output", () => {
    const result: CommandResult = {
      stdout: JSON.stringify({ version: "v0.81.1 (cae6d2a57)", semver: "0.81.1" }),
      stderr: "",
      code: 0,
    };
    expect(parseJcodeVersion(result).version).toBe("v0.81.1 (cae6d2a57)");
  });

  it("falls back to a plain version token when output is not JSON", () => {
    const result: CommandResult = { stdout: "jcode v0.81.1", stderr: "", code: 0 };
    expect(parseJcodeVersion(result).version).toBe("v0.81.1");
  });

  it("returns null when no version is present", () => {
    const result: CommandResult = { stdout: "no version here", stderr: "", code: 0 };
    expect(parseJcodeVersion(result).version).toBeNull();
  });
});

describe("checkJcodeProviderStatus", () => {
  it("reports disabled without probing when settings.enabled is false", async () => {
    const settings = decodeJcodeSettings({ enabled: false });
    const snapshot = await runNode(checkJcodeProviderStatus(settings));
    expect(snapshot.status).toBe("disabled");
    expect(snapshot.installed).toBe(false);
  });

  it("reports command-missing when the binary does not exist", async () => {
    const settings = decodeJcodeSettings({
      enabled: true,
      binaryPath: "/nonexistent/jcode-binary-xyz",
    });
    const snapshot = await runNode(checkJcodeProviderStatus(settings));
    expect(snapshot.status).toBe("error");
    expect(snapshot.installed).toBe(false);
    expect(snapshot.message ?? "").toContain("was not found");
  });

  const jcodeBinary = resolveJcodeBinary();
  const liveIt = jcodeBinary ? it : it.skip;
  liveIt(
    "drives the real jcode binary: version + ACP model discovery → ready",
    async () => {
      const settings = decodeJcodeSettings({ enabled: true, binaryPath: jcodeBinary });
      const snapshot = await runNode(checkJcodeProviderStatus(settings));
      // Installed and versioned.
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBeTruthy();
      // Handshake succeeded → ready (a warning here means model discovery
      // failed, which is still a real signal but not the happy path).
      expect(snapshot.status).toBe("ready");
      // The `model` config option produced a non-empty model catalog.
      expect(snapshot.models.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
