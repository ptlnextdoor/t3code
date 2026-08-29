import { assert, describe, it } from "@effect/vitest";

import { buildBriefing, buildItemBriefing, conversationTitle, historyQuery } from "./briefing";
import { ROSTER } from "./roster";
import type { EmployeeSummary } from "./summarize";

const paper = ROSTER.find((e) => e.id === "paper")!;

function summary(overrides: Partial<EmployeeSummary> = {}): EmployeeSummary {
  return {
    ask: {
      action: "Send",
      detail: "Manuscript still missing.",
      lead: "IECBES submission",
      text: "IECBES submission — manuscript still missing.",
    },
    badge: null,
    criticalCount: 2,
    draftCount: 3,
    employee: paper,
    state: "needs-you",
    total: 5,
    ...overrides,
  };
}

describe("buildBriefing", () => {
  it("gives the agent an identity and a job, not a summary for the human", () => {
    const text = buildBriefing(summary());
    assert.include(text, "You are Paper");
    assert.include(text, paper.role);
  });

  it("names the areas the employee owns", () => {
    assert.include(buildBriefing(summary()), "zaidi-paper");
  });

  it("leads with the top priority", () => {
    assert.include(buildBriefing(summary()), "Top priority: IECBES submission");
  });

  it("reports scale so the agent knows the size of its desk", () => {
    const text = buildBriefing(summary());
    assert.include(text, "5 open");
    assert.include(text, "2 items are on the critical path");
    assert.include(text, "3 drafts are waiting");
  });

  it("asks for a status and a single ask, and forbids a report", () => {
    // The whole failure mode of the previous system was agents producing
    // briefs about work instead of doing work.
    const text = buildBriefing(summary());
    assert.include(text, "three sentences or fewer");
    assert.include(text, "Do not write me a report");
  });

  it("handles an employee with an empty desk without inventing work", () => {
    const text = buildBriefing(
      summary({ ask: null, criticalCount: 0, draftCount: 0, state: "calm", total: 0 }),
    );
    assert.include(text, "Nothing is currently escalated");
    assert.notInclude(text, "Top priority");
  });

  it("omits the draft line when there are no drafts", () => {
    const text = buildBriefing(summary({ draftCount: 0 }));
    assert.notInclude(text, "drafts are waiting");
  });
});

describe("buildItemBriefing", () => {
  it("briefs the owner on one item with a verb, not its whole desk", () => {
    const text = buildItemBriefing(paper, "Zaidi sign-off email never sent", "Reply");
    assert.include(text, "You are Paper");
    assert.include(text, "Zaidi sign-off email never sent");
    assert.include(text, "Draft the reply");
    // The point of the employee layer: produce the thing, not a status memo.
    assert.include(text, "Do not write me a report");
  });

  it("maps each action to its own instruction", () => {
    const item = "Coleman archive: keep or kill?";
    assert.include(buildItemBriefing(paper, item, "Decide"), "options");
    assert.include(buildItemBriefing(paper, item, "Draft"), "Write the draft");
    assert.include(buildItemBriefing(paper, item, "Review"), "blocking it");
  });
});

describe("conversationTitle", () => {
  it("stays legible next to 1,518 imported chats", () => {
    assert.strictEqual(conversationTitle(paper), "Paper · standup");
  });
});

describe("historyQuery", () => {
  it("searches an employee's own topics and keywords", () => {
    const query = historyQuery(paper);
    assert.include(query, "zaidi-paper");
    assert.include(query, "iecbes");
  });
});
