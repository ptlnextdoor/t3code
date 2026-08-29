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
    assert.deepStrictEqual(
      critical?.items.map((i) => i.text),
      [
        "IECBES paper submission — HARD DEADLINE Mon Aug 31. Extra continuation line that is not a bullet.",
        "Zaidi co-author sign-off email — never sent.",
        "Boom recruiter asked twice.",
      ],
    );
  });

  it("splits each item into a bold lead and a gray detail", () => {
    const critical = parseNowSections(SAMPLE_NOW).find((s) => s.kind === "critical");
    const first = critical?.items[0];
    assert.strictEqual(first?.lead, "IECBES paper submission — HARD DEADLINE Mon Aug 31");
    const third = critical?.items[2];
    assert.strictEqual(third?.lead, "Boom recruiter asked twice.");
    assert.strictEqual(third?.detail, "");
  });

  it("infers one action verb per row", () => {
    const sections = parseNowSections(SAMPLE_NOW);
    const critical = sections.find((s) => s.kind === "critical");
    // "never sent" -> Send; "asked twice" -> Reply
    assert.strictEqual(critical?.items[1]?.action, "Send");
    assert.strictEqual(critical?.items[2]?.action, "Reply");
    // decisions always get Decide
    const decisions = sections.find((s) => s.kind === "decisions");
    assert.strictEqual(decisions?.items[0]?.action, "Decide");
    // a plain draft row falls back to Review
    const drafts = sections.find((s) => s.kind === "drafts");
    assert.strictEqual(drafts?.items[0]?.action, "Review");
  });

  it("turns table rows into lead + detail, dropping the header row", () => {
    const drafts = parseNowSections(SAMPLE_NOW).find((s) => s.kind === "drafts");
    assert.deepStrictEqual(
      drafts?.items.map((i) => [i.lead, i.detail]),
      [
        ["Linderman follow-up", "Gmail draft, HELD"],
        ["Fisher reply", "not drafted"],
      ],
    );
  });

  it("keeps a wrapped bullet whole, so its identifying words are not lost", () => {
    // Regression: a line-at-a-time reader split soft-wrapped bullets into
    // separate items. The fragments lost the words that name their owner, so
    // real escalations routed to nobody and the panel showed sentence
    // fragments. Markdown wrapping is normal writing; it must not change meaning.
    const wrapped = [
      "## 🔴 Critical",
      "- The deadline was extended to Aug 31 by the conference; the IECBES",
      "  submission is what unblocks the Linderman email.",
      "",
      "- Boom recruiter asked twice.",
    ].join("\n");
    const items = parseNowSections(wrapped)[0]?.items ?? [];
    assert.strictEqual(items.length, 2);
    assert.include(items[0]!.text, "IECBES");
    assert.include(items[0]!.text, "Linderman");
    assert.strictEqual(items[1]!.text, "Boom recruiter asked twice.");
  });

  it("does not let a bullet swallow the prose that follows a blank line", () => {
    const withProse = [
      "## 🔴 Critical",
      "- A real item.",
      "",
      "Some unindented prose that is not part of the bullet.",
    ].join("\n");
    const items = parseNowSections(withProse)[0]?.items ?? [];
    assert.deepStrictEqual(
      items.map((i) => i.text),
      ["A real item."],
    );
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
      "IECBES paper submission — HARD DEADLINE Mon Aug 31. Extra continuation line that is not a bullet.",
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
