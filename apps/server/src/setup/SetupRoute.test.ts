// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Tests for the setup route's two guarantees:
 *  - the name guard rejects anything that isn't a usable name before disk,
 *  - first-run state is BOTH files absent (in lockstep with the client logic).
 *
 * The pure helpers (validateNameForTest, computeSetupState via env-overridable
 * paths) are exercised directly; the HTTP layer's write is proven end-to-end by
 * the setup-e2e fixture, mirroring how OnboardRoute is tested.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { MAX_NAME_CHARS, computeSetupState, validateNameForTest } from "./SetupRoute.ts";

describe("setup route — name guard", () => {
  it("accepts and trims a normal name", () => {
    assert.strictEqual(validateNameForTest("  Aayu  "), "Aayu");
    assert.strictEqual(validateNameForTest("Grace Hopper"), "Grace Hopper");
  });

  it("rejects empty, whitespace, and non-strings", () => {
    assert.isNull(validateNameForTest(""));
    assert.isNull(validateNameForTest("   "));
    assert.isNull(validateNameForTest(undefined));
    assert.isNull(validateNameForTest(null));
    assert.isNull(validateNameForTest(42));
    assert.isNull(validateNameForTest({ name: "x" }));
  });

  it("rejects a paste-accident name over the cap", () => {
    assert.isNull(validateNameForTest("x".repeat(MAX_NAME_CHARS + 1)));
    assert.strictEqual(
      validateNameForTest("x".repeat(MAX_NAME_CHARS)),
      "x".repeat(MAX_NAME_CHARS),
    );
  });
});

describe("setup route — first-run state", () => {
  // computeSetupState reads process.env paths at call time. We point both at a
  // fresh temp dir so the test never touches a real ~/.t3, and toggle presence
  // by creating the files.
  it("is first run only when BOTH profile and roster are absent", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "n28-setup-"));
    const profile = NodePath.join(dir, "profile.json");
    const roster = NodePath.join(dir, "roster.json");
    const prevProfile = process.env.T3CODE_PROFILE_JSON;
    const prevRoster = process.env.T3CODE_ROSTER_JSON;
    process.env.T3CODE_PROFILE_JSON = profile;
    process.env.T3CODE_ROSTER_JSON = roster;
    try {
      assert.isTrue(computeSetupState().firstRun);

      NodeFS.writeFileSync(profile, JSON.stringify({ name: "Aayu" }));
      const s2 = computeSetupState();
      assert.isFalse(s2.firstRun);
      assert.isTrue(s2.profilePresent);
      assert.strictEqual(s2.name, "Aayu");

      NodeFS.writeFileSync(roster, "[]very-non-empty");
      const s3 = computeSetupState();
      assert.isFalse(s3.firstRun);
      assert.isTrue(s3.rosterPresent);
    } finally {
      if (prevProfile === undefined) delete process.env.T3CODE_PROFILE_JSON;
      else process.env.T3CODE_PROFILE_JSON = prevProfile;
      if (prevRoster === undefined) delete process.env.T3CODE_ROSTER_JSON;
      else process.env.T3CODE_ROSTER_JSON = prevRoster;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
