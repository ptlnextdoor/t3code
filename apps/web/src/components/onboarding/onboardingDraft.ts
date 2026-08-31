/**
 * Pure editing operations for the onboarding review step.
 *
 * The Onboarding view lets a stranger rename, merge, or delete the employees a
 * model proposed from their brain-dump before committing. Those edits are pure
 * list transforms, split out here so they are unit-testable without a DOM and
 * so the component stays a thin render over them.
 *
 * The roster shape is @t3tools/shared/onboarding's RosterEntry; keeping the ops
 * here (not in shared) is deliberate — they are UI-editing concerns, not part
 * of the assembler contract.
 */
import type { RosterEntry } from "@t3tools/shared/onboarding";

/** How many concrete items each employee owns, for the review card counts. */
export interface RosterDraftEntry extends RosterEntry {
  /** Item count carried from the assembled NOW.md, shown on the card. */
  readonly itemCount: number;
}

/** Rename one employee. Empty names are ignored so a card cannot lose its label. */
export function renameEmployee(
  roster: ReadonlyArray<RosterDraftEntry>,
  id: string,
  name: string,
): ReadonlyArray<RosterDraftEntry> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return roster;
  return roster.map((e) => (e.id === id ? { ...e, name: trimmed } : e));
}

/** Delete one employee. Its items are counted as dropped by the caller. */
export function deleteEmployee(
  roster: ReadonlyArray<RosterDraftEntry>,
  id: string,
): ReadonlyArray<RosterDraftEntry> {
  return roster.filter((e) => e.id !== id);
}

/**
 * Merge the `from` employee into the `into` employee: the survivor keeps its own
 * name and role but absorbs the other's keywords, topics, and item count, so no
 * routing coverage (and no owned items) is lost. Order is preserved at the
 * survivor's position; the absorbed card disappears.
 */
export function mergeEmployees(
  roster: ReadonlyArray<RosterDraftEntry>,
  fromId: string,
  intoId: string,
): ReadonlyArray<RosterDraftEntry> {
  if (fromId === intoId) return roster;
  const from = roster.find((e) => e.id === fromId);
  const into = roster.find((e) => e.id === intoId);
  if (!from || !into) return roster;
  const merged: RosterDraftEntry = {
    ...into,
    keywords: [...new Set([...into.keywords, ...from.keywords])],
    topics: [...new Set([...into.topics, ...from.topics])],
    itemCount: into.itemCount + from.itemCount,
  };
  return roster.flatMap((e) => (e.id === intoId ? [merged] : e.id === fromId ? [] : [e]));
}

/** Strip the UI-only itemCount before sending the roster to the commit route. */
export function toRosterPayload(
  roster: ReadonlyArray<RosterDraftEntry>,
): ReadonlyArray<RosterEntry> {
  return roster.map(({ itemCount: _itemCount, ...entry }) => entry);
}
