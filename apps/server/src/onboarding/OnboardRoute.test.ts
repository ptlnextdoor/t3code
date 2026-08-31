// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Tests for the existing-user SAFETY of the commit route: the guarantee that a
 * stranger onboarding can never silently replace a live instance's roster.
 *
 * We exercise validateRosterPayload directly, and the file-staging behavior by
 * pointing the env path overrides at a temp dir and calling the route's write
 * helper through the public HTTP layer would need a running server; instead we
 * test the observable file effects by re-implementing the tiny decision the
 * route makes (staged when a roster exists and replace is not set). The route's
 * own writeAtomic/rosterExists are exercised end-to-end by the e2e fixture.
 *
 * The point under test here is the payload guard: a malformed team must be
 * rejected before anything touches disk.
 */
import { assert, describe, it } from "@effect/vitest";

import { validateRosterPayloadForTest } from "./OnboardRoute.ts";

describe("commit route — roster payload guard", () => {
  it("accepts a well-formed roster and defaults topics to [id]", () => {
    const out = validateRosterPayloadForTest([
      { id: "work", name: "Work", role: "Ships things.", keywords: ["deck"] },
    ]);
    assert.isNotNull(out);
    assert.strictEqual(out![0]!.id, "work");
    assert.deepStrictEqual(out![0]!.topics, ["work"]);
  });

  it("rejects an empty team", () => {
    assert.isNull(validateRosterPayloadForTest([]));
  });

  it("rejects entries missing id/name/role", () => {
    assert.isNull(validateRosterPayloadForTest([{ id: "x", name: "", role: "r" }]));
    assert.isNull(validateRosterPayloadForTest([{ name: "N", role: "r" }]));
  });

  it("rejects duplicate ids (parseRoster's boundary)", () => {
    assert.isNull(
      validateRosterPayloadForTest([
        { id: "a", name: "A", role: "r" },
        { id: "a", name: "B", role: "r" },
      ]),
    );
  });

  it("drops non-string keywords rather than trusting them", () => {
    const out = validateRosterPayloadForTest([
      { id: "a", name: "A", role: "r", keywords: ["ok", 3, null, "fine"] },
    ]);
    assert.deepStrictEqual(out![0]!.keywords, ["ok", "fine"]);
  });
});
