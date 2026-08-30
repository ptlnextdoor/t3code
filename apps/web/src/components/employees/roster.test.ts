// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import {
  ARCHIVED_TOPICS,
  ROSTER,
  employeeById,
  ownerOf,
  parseRoster,
  resolveRoster,
} from "./roster";

describe("employee roster", () => {
  it("routes each real critical-path escalation to an owner", () => {
    // Verbatim leads from the live NOW.md.
    const cases: Array<[string, string]> = [
      ["IECBES paper submission — HARD DEADLINE Mon Aug 31", "paper"],
      ["Zaidi co-author sign-off email — never sent", "paper"],
      ["Boom recruiter (Megan) asked TWICE for interview availability", "apps"],
      ["Plasma Gate 1: untethered plasma on power bank due Wed Sep 3", "bench"],
      ["Linderman follow-up — Gmail draft, HELD", "outreach"],
      ["Robert Fisher reply — not drafted, he replied to you", "outreach"],
      ["Todd Coleman nudge — drafted", "outreach"],
      ["Neurologist — was the Aug 3 episode ever reported?", "ops"],
      ["Melani routing-fix PR — approve push?", "ops"],
      ["URTC poster (LUMEN pupillometry) submission closes", "bench"],
    ];
    for (const [text, expected] of cases) {
      assert.strictEqual(ownerOf(text), expected, `"${text}" should route to ${expected}`);
    }
  });

  it("returns null rather than dumping unmatched work on a catch-all", () => {
    assert.strictEqual(ownerOf("buy oat milk"), null);
  });

  it("keeps the roster small enough to be a team, not an org chart", () => {
    // If this ever needs to grow past ~7, the abstraction is wrong: the point
    // is to collapse 55 fronts into people you can hold in your head.
    assert.isAtMost(ROSTER.length, 7);
    assert.isAtLeast(ROSTER.length, 3);
  });

  it("gives every employee a role written as a job, and unique ids/topics", () => {
    const ids = new Set<string>();
    const topics = new Set<string>();
    for (const employee of ROSTER) {
      assert.isFalse(ids.has(employee.id), `duplicate id ${employee.id}`);
      ids.add(employee.id);
      assert.isAbove(employee.role.length, 20, `${employee.id} role is too thin`);
      assert.isAbove(employee.keywords.length, 3, `${employee.id} has too few keywords`);
      for (const topic of employee.topics) {
        assert.isFalse(topics.has(topic), `topic ${topic} owned twice`);
        topics.add(topic);
        assert.isFalse(
          ARCHIVED_TOPICS.includes(topic),
          `${topic} is archived and must not be staffed`,
        );
      }
    }
  });

  it("resolves employees by id", () => {
    assert.strictEqual(employeeById("paper")?.name, "Paper");
    assert.isUndefined(employeeById("nobody" as never));
  });
});

describe("roster config (de-Aayu-fication)", () => {
  const sample = JSON.stringify([
    {
      id: "sales",
      name: "Sales",
      role: "Chases the pipeline and closes deals.",
      keywords: ["lead", "deal"],
      topics: ["pipeline"],
    },
  ]);

  it("resolveRoster returns the built-in default when there is no config", () => {
    assert.strictEqual(resolveRoster(null), ROSTER);
    assert.strictEqual(resolveRoster(undefined), ROSTER);
    assert.strictEqual(resolveRoster(""), ROSTER);
  });

  it("resolveRoster loads a stranger's roster and routes against it", () => {
    const roster = resolveRoster(sample);
    assert.strictEqual(roster.length, 1);
    assert.strictEqual(roster[0]?.name, "Sales");
    assert.strictEqual(ownerOf("new lead from the form", roster), "sales");
    assert.strictEqual(employeeById("sales", roster)?.name, "Sales");
  });

  it("resolveRoster falls back to the default on malformed or empty config", () => {
    assert.strictEqual(resolveRoster("not json"), ROSTER);
    assert.strictEqual(resolveRoster("[]"), ROSTER);
    assert.strictEqual(resolveRoster('[{"id":"x"}]'), ROSTER);
  });

  it("parseRoster rejects invalid shapes with a precise reason", () => {
    assert.throws(() => parseRoster({}), /array/);
    assert.throws(
      () => parseRoster([{ id: "", name: "n", role: "r", keywords: [], topics: [] }]),
      /id/,
    );
    assert.throws(
      () => parseRoster([{ id: "a", name: "A", role: "R", keywords: [1], topics: [] }]),
      /keywords/,
    );
    assert.throws(
      () =>
        parseRoster([
          { id: "dup", name: "A", role: "R", keywords: [], topics: [] },
          { id: "dup", name: "B", role: "R", keywords: [], topics: [] },
        ]),
      /duplicated/,
    );
  });
});
