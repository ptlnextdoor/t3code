/**
 * Manual team-building: the fallback when no AI model is on the machine.
 *
 * Voice-note onboarding needs one LLM call to turn a rambling brain-dump into
 * structured fronts (see server extractFronts). A friend testing this may have
 * no `claude`/`jcode` logged in, so that call 503s. Rather than a dead button,
 * the UI lets them type their team directly: a few life-areas, each with a
 * role and a handful of items.
 *
 * This module is the pure part: manual rows -> the SAME OnboardingExtraction
 * shape the LLM path produces, so everything downstream (assembleOnboarding,
 * the review cards, the commit route) is reused unchanged. No second code path.
 */
import type { OnboardingExtraction, OnboardingFront } from "@t3tools/shared/onboarding";

/** One life-area a person types by hand. `items` is a raw textarea, one per line. */
export interface ManualArea {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** Free text, one item per line. Blank lines are ignored on build. */
  readonly items: string;
}

/** A blank area with a stable id, for a fresh "Add area" row. */
export function emptyArea(id: string): ManualArea {
  return { id, name: "", role: "", items: "" };
}

/** The starter set: two prompts so the form is never an intimidating blank. */
export function starterAreas(): ReadonlyArray<ManualArea> {
  return [emptyArea("area-1"), emptyArea("area-2")];
}

/** Update one field on one area. Pure list transform for the component. */
export function updateArea(
  areas: ReadonlyArray<ManualArea>,
  id: string,
  patch: Partial<Omit<ManualArea, "id">>,
): ReadonlyArray<ManualArea> {
  return areas.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

/** Drop one area. */
export function removeArea(
  areas: ReadonlyArray<ManualArea>,
  id: string,
): ReadonlyArray<ManualArea> {
  return areas.filter((a) => a.id !== id);
}

/** Add a blank area with an id that will not collide with the current set. */
export function addArea(areas: ReadonlyArray<ManualArea>): ReadonlyArray<ManualArea> {
  const nextIndex = areas.length + 1;
  let id = `area-${nextIndex}`;
  const taken = new Set(areas.map((a) => a.id));
  let n = nextIndex;
  while (taken.has(id)) id = `area-${(n += 1)}`;
  return [...areas, emptyArea(id)];
}

/** True when at least one area has a name and one non-empty item line. */
export function hasBuildableArea(areas: ReadonlyArray<ManualArea>): boolean {
  return areas.some(
    (a) => a.name.trim().length > 0 && a.items.split("\n").some((l) => l.trim().length > 0),
  );
}

/**
 * Turn manual rows into the extraction the assembler expects. An area with no
 * name or no items is skipped (it is an unfinished form row, not a front).
 * Urgency is left at "medium": the manual path has no model to judge pressure,
 * and the deadline parser still promotes anything the user dates in an item.
 */
export function manualToExtraction(areas: ReadonlyArray<ManualArea>): OnboardingExtraction {
  const fronts: Array<OnboardingFront> = [];
  for (const area of areas) {
    const name = area.name.trim();
    if (name.length === 0) continue;
    const items = area.items
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => ({ text }));
    if (items.length === 0) continue;
    const role = area.role.trim().length > 0 ? area.role.trim() : `Owns everything under ${name}.`;
    fronts.push({ front: name, role, urgency: "medium", items });
  }
  return { fronts };
}
