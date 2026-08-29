// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import { parseNowSections } from "../todayPanel.logic";
import { countNeedingYou, summarizeEmployees } from "./summarize";

/** A trimmed copy of the real NOW.md shape. */
const NOW = `# NOW

## 🔴 Critical path (next 72h)

1. **IECBES paper submission — HARD DEADLINE Mon Aug 31.** Manuscript missing.
2. **Zaidi co-author sign-off email — never sent.**
3. **Boom recruiter (Megan) asked TWICE for interview availability.**
4. **Plasma Gate 1: untethered plasma on power bank due Wed Sep 3.** No hardware.

## 🟠 Unsent drafts

| Draft | Where | Blocked on |
|---|---|---|
| Linderman follow-up | Gmail draft, HELD | submission |
| Todd Coleman nudge | drafted | your send |
| Zare cold email | drafted | citation |
| Bueno Garcia | drafted | approval |

## 🔵 Decisions hanging

- Neurologist — was the Aug 3 episode ever reported?
- Coleman archive — keep or kill?
`;

const summaries = summarizeEmployees(parseNowSections(NOW));
const byId = (id: string) => summaries.find((s) => s.employee.id === id);

describe("summarizeEmployees", () => {
  it("returns the full roster, including employees with nothing owed", () => {
    // A team member who vanishes when idle reads as a bug, not as calm.
    assert.strictEqual(summaries.length, 5);
  });

  it("gives each employee its highest-priority ask", () => {
    assert.include(byId("paper")?.ask?.lead ?? "", "IECBES");
    assert.include(byId("apps")?.ask?.lead ?? "", "Boom recruiter");
    assert.include(byId("bench")?.ask?.lead ?? "", "Plasma Gate 1");
    // Outreach has no critical item, so its top draft becomes the ask.
    assert.include(byId("outreach")?.ask?.lead ?? "", "Linderman");
  });

  it("prefers critical items over drafts for the headline", () => {
    const paper = byId("paper");
    assert.strictEqual(paper?.criticalCount, 2);
    assert.include(paper?.ask?.lead ?? "", "IECBES");
  });

  it("reserves needs-you for the critical path only", () => {
    // Lighting every row red destroys the signal. Only genuinely blocking
    // work is red; queued drafts and decisions are amber "dated".
    assert.strictEqual(byId("paper")?.state, "needs-you");
    assert.strictEqual(byId("apps")?.state, "needs-you");
    assert.strictEqual(byId("bench")?.state, "needs-you");
    // Outreach holds four drafts but nothing on the critical path.
    assert.strictEqual(byId("outreach")?.state, "dated");
  });

  it("marks decision-only employees as dated, not blocking", () => {
    assert.strictEqual(byId("ops")?.state, "dated");
  });

  it("badges plural work so the row shows scale without a second line", () => {
    assert.strictEqual(byId("outreach")?.badge, "4 drafts");
    // Blocking count wins over draft count when both are plural.
    assert.strictEqual(byId("paper")?.badge, "2 blocking");
    // A single item needs no badge; the ask already says it.
    assert.isNull(byId("apps")?.badge);
  });

  it("counts only the employees actually blocking the human", () => {
    // Three of five, so the header count is a real signal rather than
    // a restatement of the roster size.
    assert.strictEqual(countNeedingYou(summaries), 3);
    assert.isBelow(countNeedingYou(summaries), summaries.length);
  });

  it("collapses every escalation into at most five people", () => {
    const totalOwned = summaries.reduce((sum, s) => sum + s.total, 0);
    assert.strictEqual(totalOwned, 10);
  });
});
