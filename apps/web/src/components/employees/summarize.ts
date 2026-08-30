/**
 * Roll up NOW.md escalations into per-employee summaries.
 *
 * This is the join that makes the employee layer worth existing: it turns a
 * flat list of 26 items into five people, each with one headline ask.
 * Pure and framework-free so it can be unit tested directly.
 */
import type { TodayItem, TodaySection } from "../todayPanel.logic";
import { ROSTER, ownerOf, type Employee, type EmployeeId } from "./roster";

/** How much of the human's attention an employee currently needs. */
export type EmployeeState = "needs-you" | "dated" | "calm";

export interface EmployeeSummary {
  readonly employee: Employee;
  readonly state: EmployeeState;
  /** The single most important thing this employee needs, already split. */
  readonly ask: TodayItem | null;
  /** Short status shown under the ask, e.g. "4 drafts waiting". */
  readonly badge: string | null;
  /** Count of everything this employee owns across all sections. */
  readonly total: number;
  readonly criticalCount: number;
  readonly draftCount: number;
}

/**
 * Build one summary per employee.
 *
 * Priority for the headline ask, in order:
 *   1. a critical-path item        (this is what blocks the human today)
 *   2. a draft waiting on approval (one click from done)
 *   3. a hanging decision
 * Employees with nothing owed stay in the roster as "calm" rather than being
 * hidden, because a disappearing team member reads as a bug, not as calm.
 */
export function summarizeEmployees(
  sections: ReadonlyArray<TodaySection>,
  roster: ReadonlyArray<Employee> = ROSTER,
): ReadonlyArray<EmployeeSummary> {
  const byKind = (kind: string) => sections.find((section) => section.kind === kind)?.items ?? [];
  const critical = byKind("critical");
  const drafts = byKind("drafts");
  const decisions = byKind("decisions");

  const owned = (items: ReadonlyArray<TodayItem>, id: EmployeeId) =>
    items.filter((item) => ownerOf(item.text, roster) === id);

  return roster.map((employee) => {
    const myCritical = owned(critical, employee.id);
    const myDrafts = owned(drafts, employee.id);
    const myDecisions = owned(decisions, employee.id);

    const ask = myCritical[0] ?? myDrafts[0] ?? myDecisions[0] ?? null;
    /*
     * State must discriminate, or it is wallpaper. An earlier version marked
     * any employee with a draft as "needs-you", which lit all five rows red
     * and destroyed the signal. Only the critical path truly blocks the human;
     * queued drafts and open decisions are work, not emergencies.
     */
    const state: EmployeeState =
      myCritical.length > 0
        ? "needs-you"
        : myDrafts.length + myDecisions.length > 0
          ? "dated"
          : "calm";

    // The badge answers "how much of this is there?" without a second row.
    const badge =
      myCritical.length > 1
        ? `${myCritical.length} blocking`
        : myDrafts.length > 1
          ? `${myDrafts.length} drafts`
          : myDecisions.length > 1
            ? `${myDecisions.length} decisions`
            : null;

    return {
      ask,
      badge,
      criticalCount: myCritical.length,
      draftCount: myDrafts.length,
      employee,
      state,
      total: myCritical.length + myDrafts.length + myDecisions.length,
    };
  });
}

/** Employees actively blocking the human. Drives the header count. */
export function countNeedingYou(summaries: ReadonlyArray<EmployeeSummary>): number {
  return summaries.filter((summary) => summary.state === "needs-you").length;
}
