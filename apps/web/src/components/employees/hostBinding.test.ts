// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";
import type { EnvironmentId } from "@t3tools/contracts";

import { resolveEmployeeHost, type EnvironmentLookupEntry } from "./hostBinding";

const PRIMARY = "env-primary" as EnvironmentId;
const REMOTE = "env-hetzner" as EnvironmentId;

function env(
  id: string,
  phase: EnvironmentLookupEntry["phase"],
  label = id,
): EnvironmentLookupEntry {
  return { environmentId: id as EnvironmentId, label, phase };
}

describe("resolveEmployeeHost", () => {
  const environments = [
    env("env-primary", "connected", "This Mac"),
    env("env-hetzner", "connected", "Melani's server"),
  ];

  it("opens on the primary when host is absent, empty, or 'local'", () => {
    for (const host of [undefined, "", "  ", "local", "LOCAL"]) {
      const out = resolveEmployeeHost({ host, primaryEnvironmentId: PRIMARY, environments });
      assert.deepStrictEqual(out, { kind: "local", environmentId: PRIMARY });
    }
  });

  it("treats a host equal to the primary id as local", () => {
    const out = resolveEmployeeHost({
      host: "env-primary",
      primaryEnvironmentId: PRIMARY,
      environments,
    });
    assert.deepStrictEqual(out, { kind: "local", environmentId: PRIMARY });
  });

  it("opens on a connected remote host", () => {
    const out = resolveEmployeeHost({
      host: "env-hetzner",
      primaryEnvironmentId: PRIMARY,
      environments,
    });
    assert.deepStrictEqual(out, { kind: "remote", environmentId: REMOTE });
  });

  it("returns offline for a known-but-disconnected remote host, naming its label", () => {
    for (const phase of ["available", "connecting", "reconnecting", "offline", "error"] as const) {
      const out = resolveEmployeeHost({
        host: "env-hetzner",
        primaryEnvironmentId: PRIMARY,
        environments: [
          env("env-primary", "connected", "This Mac"),
          env("env-hetzner", phase, "Melani's server"),
        ],
      });
      assert.deepStrictEqual(out, {
        kind: "offline",
        environmentId: REMOTE,
        environmentLabel: "Melani's server",
      });
    }
  });

  it("returns offline for an unknown host the client has never connected to", () => {
    const out = resolveEmployeeHost({
      host: "env-ghost",
      primaryEnvironmentId: PRIMARY,
      environments,
    });
    assert.deepStrictEqual(out, {
      kind: "offline",
      environmentId: "env-ghost",
      environmentLabel: "env-ghost",
    });
  });

  it("returns offline for a local host when there is no primary environment yet", () => {
    const out = resolveEmployeeHost({
      host: undefined,
      primaryEnvironmentId: null,
      environments: [],
    });
    assert.deepStrictEqual(out, {
      kind: "offline",
      environmentId: "local",
      environmentLabel: "This Mac",
    });
  });
});
