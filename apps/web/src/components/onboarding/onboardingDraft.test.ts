import { assert, describe, it } from "@effect/vitest";

import {
  deleteEmployee,
  mergeEmployees,
  renameEmployee,
  toRosterPayload,
  type RosterDraftEntry,
} from "./onboardingDraft";

const ROSTER: ReadonlyArray<RosterDraftEntry> = [
  {
    id: "work",
    name: "Work",
    role: "Ships things.",
    keywords: ["deck"],
    topics: ["work"],
    itemCount: 3,
  },
  {
    id: "family",
    name: "Family",
    role: "Cares for people.",
    keywords: ["mom"],
    topics: ["family"],
    itemCount: 2,
  },
  {
    id: "money",
    name: "Money",
    role: "Handles cash.",
    keywords: ["reimbursement"],
    topics: ["money"],
    itemCount: 1,
  },
];

describe("onboarding draft ops", () => {
  it("renames an employee, ignoring an empty name", () => {
    assert.strictEqual(renameEmployee(ROSTER, "work", "Career")[0]!.name, "Career");
    assert.strictEqual(renameEmployee(ROSTER, "work", "   ")[0]!.name, "Work");
  });

  it("deletes an employee", () => {
    const out = deleteEmployee(ROSTER, "family");
    assert.deepStrictEqual(
      out.map((e) => e.id),
      ["work", "money"],
    );
  });

  it("merges keywords, topics, and item counts into the survivor", () => {
    const out = mergeEmployees(ROSTER, "money", "work");
    assert.strictEqual(out.length, 2);
    const work = out.find((e) => e.id === "work")!;
    assert.strictEqual(work.itemCount, 4);
    assert.include(work.keywords, "reimbursement");
    assert.include(work.topics, "money");
    assert.isUndefined(out.find((e) => e.id === "money"));
  });

  it("preserves the survivor's position and dedupes", () => {
    const withDup: ReadonlyArray<RosterDraftEntry> = [
      { ...ROSTER[0]!, keywords: ["deck", "shared"] },
      { ...ROSTER[1]!, keywords: ["mom", "shared"] },
    ];
    const out = mergeEmployees(withDup, "family", "work");
    assert.deepStrictEqual(
      out.map((e) => e.id),
      ["work"],
    );
    assert.deepStrictEqual([...out[0]!.keywords].sort(), ["deck", "mom", "shared"]);
  });

  it("is a no-op when merging an id into itself or a missing id", () => {
    assert.strictEqual(mergeEmployees(ROSTER, "work", "work").length, 3);
    assert.strictEqual(mergeEmployees(ROSTER, "ghost", "work").length, 3);
  });

  it("strips itemCount for the commit payload", () => {
    const payload = toRosterPayload(ROSTER);
    assert.isFalse("itemCount" in payload[0]!);
    assert.strictEqual(payload[0]!.id, "work");
  });
});
