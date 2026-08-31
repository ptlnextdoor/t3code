import { describe, expect, it } from "vite-plus/test";

import type { EmployeeSummary } from "../employees/summarize";
import { buildSections, TEAM_SECTION_ID, UNASSIGNED_SECTION_ID } from "./sections";

function summary(
  id: string,
  state: EmployeeSummary["state"],
  topics: ReadonlyArray<string>,
): EmployeeSummary {
  return {
    ask: null,
    badge: null,
    criticalCount: 0,
    draftCount: 0,
    employee: { id, keywords: [], name: id, role: "role", topics },
    state,
    total: state === "calm" ? 0 : 1,
  };
}

describe("buildSections", () => {
  it("puts every staffed employee in a single Team section when none are unassigned", () => {
    const sections = buildSections([
      summary("paper", "needs-you", ["zaidi-paper"]),
      summary("ops", "dated", ["melani"]),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe(TEAM_SECTION_ID);
    expect(sections[0].employees.map((s) => s.employee.id)).toEqual(["paper", "ops"]);
  });

  it("splits out calm, topicless employees into a synthetic Unassigned bucket", () => {
    const sections = buildSections([
      summary("paper", "needs-you", ["zaidi-paper"]),
      summary("ghost", "calm", []),
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[1].id).toBe(UNASSIGNED_SECTION_ID);
    expect(sections[1].synthetic).toBe(true);
    expect(sections[1].employees.map((s) => s.employee.id)).toEqual(["ghost"]);
  });

  it("omits the Unassigned bucket entirely when empty", () => {
    const sections = buildSections([summary("paper", "calm", ["zaidi-paper"])]);
    expect(sections.every((s) => s.id !== UNASSIGNED_SECTION_ID)).toBe(true);
  });

  it("keeps a calm employee that still owns a topic in Team, not Unassigned", () => {
    const sections = buildSections([summary("paper", "calm", ["zaidi-paper"])]);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe(TEAM_SECTION_ID);
  });
});
