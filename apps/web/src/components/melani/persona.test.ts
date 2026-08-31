import { describe, expect, it } from "vite-plus/test";

import { resolvePersona } from "./persona";

describe("resolvePersona", () => {
  it("takes the initial from the name, uppercased", () => {
    expect(resolvePersona("paper", "Paper").initial).toBe("P");
    expect(resolvePersona("outreach", "outreach").initial).toBe("O");
  });

  it("falls back to the id when the name is blank", () => {
    expect(resolvePersona("bench", "   ").initial).toBe("B");
  });

  it("is stable for the same id", () => {
    expect(resolvePersona("ops", "Ops")).toEqual(resolvePersona("ops", "Ops"));
  });

  it("separates ids that share a first letter into different hues", () => {
    // "apps" and "ops" would collide under charCodeAt(0); the hash must not.
    expect(resolvePersona("apps", "Apps").hue).not.toBe(resolvePersona("ops", "Ops").hue);
  });

  it("keeps the hue inside [0, 359]", () => {
    for (const id of ["paper", "outreach", "apps", "bench", "ops", "x", ""]) {
      const { hue } = resolvePersona(id || "z", id || "z");
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
