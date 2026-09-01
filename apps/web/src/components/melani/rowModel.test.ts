import { describe, expect, it } from "vite-plus/test";

import type { EmployeeSummary } from "../employees/summarize";
import { rowPreview, rowStatus, rowTrailing } from "./rowModel";

function base(overrides: Partial<EmployeeSummary>): EmployeeSummary {
  return {
    ask: null,
    badge: null,
    criticalCount: 0,
    draftCount: 0,
    employee: { id: "paper", keywords: [], name: "Paper", role: "Ship the paper.", topics: ["p"] },
    state: "calm",
    total: 0,
    ...overrides,
  };
}

describe("rowPreview", () => {
  it("renders a waiting-for-you line from the ask", () => {
    const summary = base({
      ask: { text: "Approve v8", lead: "Approve v8", detail: "before Monday", action: null },
      state: "needs-you",
      total: 1,
    });
    expect(rowPreview(summary)).toBe("Waiting for you: Approve v8 before Monday");
  });

  it("falls back to the role when there is no ask", () => {
    expect(rowPreview(base({}))).toBe("Ship the paper.");
  });
});

describe("rowStatus", () => {
  it("maps needs-you to attention, dated to working, calm to calm", () => {
    expect(rowStatus(base({ state: "needs-you" }))).toBe("attention");
    expect(rowStatus(base({ state: "dated" }))).toBe("working");
    expect(rowStatus(base({ state: "calm" }))).toBe("calm");
  });
});

describe("rowTrailing", () => {
  it("summarises the open count, singular and plural", () => {
    expect(rowTrailing(base({ total: 0 }))).toBeNull();
    expect(rowTrailing(base({ total: 1 }))).toBe("1 open");
    expect(rowTrailing(base({ total: 4 }))).toBe("4 open");
  });
});
