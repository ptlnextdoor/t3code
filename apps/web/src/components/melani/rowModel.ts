/**
 * Pure projections that turn an `EmployeeSummary` into the three signals a
 * Melani sidebar row renders: a one-line preview, a relative-time label, and a
 * status corner-dot colour. UI-SPEC §2.2/§2.3.
 *
 * Kept framework-free so the row's copy is unit-tested directly rather than
 * asserted through the DOM.
 */
import type { EmployeeSummary } from "../employees/summarize";

/** Status corner-dot state. Maps to a colour token in CSS. UI-SPEC §2.2. */
export type RowStatus = "working" | "attention" | "calm";

/**
 * The preview line under the name. Priority mirrors the spec's row contract:
 * a genuine ask ("Waiting for you: …") beats the calm fallback (the role).
 * The employee summary has already picked the single headline ask, so this is
 * just presentation.
 */
export function rowPreview(summary: EmployeeSummary): string {
  if (summary.ask) {
    const lead = summary.ask.lead?.trim();
    const detail = summary.ask.detail?.trim();
    const body = [lead, detail].filter((part) => part && part.length > 0).join(" ");
    return `Waiting for you: ${body || summary.ask.text}`;
  }
  return summary.employee.role;
}

/**
 * Corner-dot status. `needs-you` is the only truly blocking state, so it is the
 * one that earns the amber "attention" dot; `dated` work (queued drafts, open
 * decisions) reads as quietly "working"; nothing owed is "calm" (no dot).
 * This deliberately reuses the summary's already-discriminated state rather
 * than re-deriving urgency, so the dot and the header count never disagree.
 */
export function rowStatus(summary: EmployeeSummary): RowStatus {
  if (summary.state === "needs-you") return "attention";
  if (summary.state === "dated") return "working";
  return "calm";
}

/**
 * A relative-time label for the row's trailing slot. The employee layer has no
 * per-employee timestamp yet (it is a projection over NOW.md, not a message
 * store), so we surface the count of open items as the trailing signal instead
 * of a fabricated time. `null` when nothing is owed, so the slot stays empty
 * rather than printing "0 open".
 *
 * When N3.3 lands real per-message timestamps, swap this for an actual
 * `now/12m/3h/2d` formatter (the shape the spec names) keyed on last activity.
 */
export function rowTrailing(summary: EmployeeSummary): string | null {
  if (summary.total <= 0) return null;
  return summary.total === 1 ? "1 open" : `${summary.total} open`;
}
