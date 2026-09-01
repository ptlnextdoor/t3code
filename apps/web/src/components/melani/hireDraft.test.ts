// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import { parseKeywordInput, slugifyEmployeeId, validateHireDraft } from "./hireDraft";

describe("slugifyEmployeeId", () => {
  it("lowercases and hyphenates", () => {
    assert.strictEqual(slugifyEmployeeId("Melani's Server"), "melani-s-server");
    assert.strictEqual(slugifyEmployeeId("  Bench  "), "bench");
    assert.strictEqual(slugifyEmployeeId("R&D Team"), "r-d-team");
  });

  it("returns empty for a name with no alphanumerics", () => {
    assert.strictEqual(slugifyEmployeeId("!!!"), "");
    assert.strictEqual(slugifyEmployeeId("   "), "");
  });
});

describe("parseKeywordInput", () => {
  it("splits, trims, lowercases, and dedupes", () => {
    assert.deepStrictEqual(parseKeywordInput("Plasma, hardware ,plasma\nBench"), [
      "plasma",
      "hardware",
      "bench",
    ]);
  });

  it("returns empty for blank input", () => {
    assert.deepStrictEqual(parseKeywordInput("  , \n "), []);
  });
});

describe("validateHireDraft", () => {
  it("builds a POST-ready draft with a derived id and no host by default", () => {
    const out = validateHireDraft({
      name: "Bench",
      role: "Keeps the benchmark honest.",
      keywords: ["plasma"],
      host: "local",
      existingIds: [],
    });
    assert.isTrue(out.ok);
    if (out.ok) {
      assert.strictEqual(out.draft.id, "bench");
      assert.notProperty(out.draft, "host");
      assert.deepStrictEqual(out.draft.keywords, ["plasma"]);
    }
  });

  it("keeps a real remote host", () => {
    const out = validateHireDraft({
      name: "Ops",
      role: "Runs the box.",
      keywords: [],
      host: "env-hetzner",
      existingIds: [],
    });
    assert.isTrue(out.ok && out.draft.host === "env-hetzner");
  });

  it("rejects an empty name, an unusable name, an empty role, and a duplicate id", () => {
    assert.isFalse(
      validateHireDraft({ name: "", role: "r", keywords: [], host: "local", existingIds: [] }).ok,
    );
    assert.isFalse(
      validateHireDraft({ name: "!!!", role: "r", keywords: [], host: "local", existingIds: [] })
        .ok,
    );
    assert.isFalse(
      validateHireDraft({ name: "Bench", role: "", keywords: [], host: "local", existingIds: [] })
        .ok,
    );
    const dup = validateHireDraft({
      name: "Bench",
      role: "r",
      keywords: [],
      host: "local",
      existingIds: ["bench"],
    });
    assert.isFalse(dup.ok);
  });
});
