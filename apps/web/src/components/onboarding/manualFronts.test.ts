import { describe, expect, it } from "@effect/vitest";

import { assembleOnboarding } from "@t3tools/shared/onboarding";
import {
  addArea,
  emptyArea,
  hasBuildableArea,
  manualToExtraction,
  removeArea,
  starterAreas,
  updateArea,
  type ManualArea,
} from "./manualFronts";

const filled: ReadonlyArray<ManualArea> = [
  {
    id: "area-1",
    name: "Work",
    role: "Ship the deck",
    items: "Chase Marcus for revenue\nBook the room",
  },
  { id: "area-2", name: "Family", role: "", items: "Drive mom to appt\n" },
];

describe("manualFronts", () => {
  it("starts with two blank areas", () => {
    const areas = starterAreas();
    expect(areas).toHaveLength(2);
    expect(hasBuildableArea(areas)).toBe(false);
  });

  it("needs a name AND an item to be buildable", () => {
    expect(hasBuildableArea([emptyArea("a")])).toBe(false);
    expect(hasBuildableArea([{ id: "a", name: "Work", role: "", items: "" }])).toBe(false);
    expect(hasBuildableArea([{ id: "a", name: "", role: "", items: "do a thing" }])).toBe(false);
    expect(hasBuildableArea([{ id: "a", name: "Work", role: "", items: "do a thing" }])).toBe(true);
  });

  it("updates and removes areas immutably", () => {
    const areas = starterAreas();
    const named = updateArea(areas, "area-1", { name: "Money" });
    expect(named[0]!.name).toBe("Money");
    expect(areas[0]!.name).toBe(""); // original untouched
    expect(removeArea(named, "area-1")).toHaveLength(1);
  });

  it("adds an area with a non-colliding id", () => {
    const grown = addArea(starterAreas());
    expect(grown).toHaveLength(3);
    expect(new Set(grown.map((a) => a.id)).size).toBe(3);
  });

  it("skips unfinished rows and splits items by line", () => {
    const extraction = manualToExtraction(filled);
    expect(extraction.fronts.map((f) => f.front)).toEqual(["Work", "Family"]);
    expect(extraction.fronts[0]!.items).toHaveLength(2);
    // Family had a trailing blank line; it must not become an empty item.
    expect(extraction.fronts[1]!.items).toHaveLength(1);
    // A missing role gets a sensible default, not an empty string.
    expect(extraction.fronts[1]!.role).toContain("Family");
  });

  it("drops rows with a name but no items, and rows with items but no name", () => {
    const extraction = manualToExtraction([
      { id: "a", name: "Empty", role: "", items: "   \n  " },
      { id: "b", name: "", role: "", items: "orphan item" },
    ]);
    expect(extraction.fronts).toHaveLength(0);
  });

  it("assembles through the real onboarding pipeline: every item routes to an owner", () => {
    const assembled = assembleOnboarding(manualToExtraction(filled));
    // Three items typed, three captured, a roster entry per named area.
    expect(assembled.items).toBe(3);
    expect(assembled.roster).toHaveLength(2);
    expect(assembled.nowMd).toContain("NOW");
  });
});
