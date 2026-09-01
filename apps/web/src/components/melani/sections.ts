/**
 * Group employees into the sidebar's collapsible sections. UI-SPEC §1.5.
 *
 * The reference app has durable, user-editable "life-area" sections plus a
 * synthetic terminal "Unassigned" bucket. Our roster (employees/roster.ts) has
 * no life-area field and is config-driven per instance, so hardcoding an
 * id→area map would break a stranger's roster. For N3.1 we ship the two
 * sections the spec's synthetic-terminal rule guarantees are always correct:
 *
 *   - one real "Team" section holding every staffed employee, and
 *   - a synthetic "Unassigned" section, rendered only when it has members
 *     (employees with nothing owed and no topics — genuinely unrouted).
 *
 * User-defined life-areas, membership editing, and section CRUD are DEFERRED
 * (they need the bulk/drag machinery the spec parks with selection-mode). What
 * lands now is the collapsible-section frame + the synthetic bucket + durable
 * collapse, so the later work slots in without reshaping the DOM.
 */
import type { EmployeeSummary } from "../employees/summarize";

/** The always-present synthetic bucket id. Cannot be renamed or removed. */
export const UNASSIGNED_SECTION_ID = "__unassigned__";
/** The default real section every staffed employee falls into. */
export const TEAM_SECTION_ID = "__team__";

export interface MelaniSection {
  readonly id: string;
  readonly title: string;
  /** True for the synthetic Unassigned bucket, which has no durable membership. */
  readonly synthetic: boolean;
  readonly employees: ReadonlyArray<EmployeeSummary>;
}

/**
 * An employee is "unassigned" when it is both calm (nothing escalated) and owns
 * no topic area — i.e. it is on the roster but carries no live signal at all.
 * That is the only case where dropping it into a separate bucket clarifies
 * rather than hides, matching the spec's "unrouted" framing.
 */
function isUnassigned(summary: EmployeeSummary): boolean {
  return summary.state === "calm" && summary.employee.topics.length === 0;
}

/**
 * Partition summaries into ordered sections. The Team section preserves roster
 * order (which is already priority-ordered); Unassigned is appended and omitted
 * entirely when empty, so a fully-staffed roster shows a single flat section.
 */
export function buildSections(
  summaries: ReadonlyArray<EmployeeSummary>,
): ReadonlyArray<MelaniSection> {
  const team: Array<EmployeeSummary> = [];
  const unassigned: Array<EmployeeSummary> = [];
  for (const summary of summaries) {
    (isUnassigned(summary) ? unassigned : team).push(summary);
  }

  const sections: Array<MelaniSection> = [
    { employees: team, id: TEAM_SECTION_ID, synthetic: false, title: "Team" },
  ];
  if (unassigned.length > 0) {
    sections.push({
      employees: unassigned,
      id: UNASSIGNED_SECTION_ID,
      synthetic: true,
      title: "Unassigned",
    });
  }
  return sections;
}
