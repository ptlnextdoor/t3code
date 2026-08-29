// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import { deadlineLabel, extractCriticalLines, parseNowSections } from "./todayPanel.logic";

const SAMPLE_NOW = `# NOW — what needs YOU

Updated 2026-08-28.

## 🔴 Critical path (next 72h)

1. **IECBES paper submission — HARD DEADLINE Mon Aug 31.**
   Extra continuation line that is not a bullet.
2. **Zaidi co-author sign-off email — never sent.**
- Boom recruiter asked twice.

## 🟠 Unsent drafts (each is 1 approval away)

| Draft | Where | Blocked on |
|---|---|---|
| Linderman follow-up | Gmail draft, HELD | submission |
| Fisher reply | not drafted | you |

## 🟡 Deadlines calendar

- Mon Aug 31 — IECBES submission (hard).
- Wed Sep 3 — Plasma Gate 1 hardware demo.

## 🔵 Decisions hanging

- URTC Aug 9 submission — did it happen?
`;

describe("parseNowSections", () => {
  it("splits NOW.md into typed sections with the right kinds", () => {
    const sections = parseNowSections(SAMPLE_NOW);
    const kinds = sections.map((s) => s.kind);
    assert.deepStrictEqual(kinds, ["critical", "drafts", "deadlines", "decisions"]);
  });

  it("captures bullet and numbered items, markdown stripped", () => {
    const critical = parseNowSections(SAMPLE_NOW).find((s) => s.kind === "critical");
    assert.deepStrictEqual(critical?.items, [
      "IECBES paper submission — HARD DEADLINE Mon Aug 31.",
      "Zaidi co-author sign-off email — never sent.",
      "Boom recruiter asked twice.",
    ]);
  });

  it("flattens table rows to 'label — where', dropping the header row", () => {
    const drafts = parseNowSections(SAMPLE_NOW).find((s) => s.kind === "drafts");
    assert.deepStrictEqual(drafts?.items, [
      "Linderman follow-up — Gmail draft, HELD",
      "Fisher reply — not drafted",
    ]);
  });

  it("drops empty sections", () => {
    const sections = parseNowSections("## Empty\n\n## 🔴 Critical\n- one");
    assert.deepStrictEqual(
      sections.map((s) => s.kind),
      ["critical"],
    );
  });
});

describe("extractCriticalLines", () => {
  it("returns the critical section's items only", () => {
    assert.deepStrictEqual(extractCriticalLines(SAMPLE_NOW), [
      "IECBES paper submission — HARD DEADLINE Mon Aug 31.",
      "Zaidi co-author sign-off email — never sent.",
      "Boom recruiter asked twice.",
    ]);
  });

  it("caps at 6", () => {
    const many = ["## 🔴 Critical", ...Array.from({ length: 10 }, (_, i) => `- item ${i}`)].join(
      "\n",
    );
    assert.strictEqual(extractCriticalLines(many).length, 6);
  });
});

describe("deadlineLabel", () => {
  const now = new Date(2026, 7, 29); // Sat Aug 29 2026

  it("labels near-future dates in days", () => {
    assert.strictEqual(deadlineLabel("Mon Aug 31 — IECBES", now), "2d");
    assert.strictEqual(deadlineLabel("Wed Sep 3 — Gate 1", now), "5d");
  });

  it("labels today and tomorrow", () => {
    assert.strictEqual(deadlineLabel("Aug 29 thing", now), "today");
    assert.strictEqual(deadlineLabel("Aug 30 thing", now), "tomorrow");
  });

  it("returns overdue for a date more than a day past", () => {
    assert.strictEqual(deadlineLabel("Aug 20 thing", now), "overdue");
  });

  it("returns null when no date is present or it is far away", () => {
    assert.strictEqual(deadlineLabel("no date here", now), null);
    assert.strictEqual(deadlineLabel("Dec 25 thing", now), null);
  });
});
