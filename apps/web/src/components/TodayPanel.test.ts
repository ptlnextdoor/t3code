import { assert, describe, it } from "@effect/vitest";

import { extractCriticalLines } from "./TodayPanel";

const SAMPLE_NOW = `# NOW — what needs YOU

Updated 2026-08-28.

## 🔴 Critical path (next 72h)

1. **IECBES paper submission — HARD DEADLINE Mon Aug 31.**
   Extra continuation line that is not a bullet.
2. **Zaidi co-author sign-off email — never sent.**
- Boom recruiter asked twice.

## 🟠 Unsent drafts

| Draft | Where |
|---|---|
| Linderman | Gmail |
`;

describe("extractCriticalLines", () => {
  it("pulls only the first section's bullet/numbered lines, markdown stripped", () => {
    const lines = extractCriticalLines(SAMPLE_NOW);
    assert.deepStrictEqual(lines, [
      "IECBES paper submission — HARD DEADLINE Mon Aug 31.",
      "Zaidi co-author sign-off email — never sent.",
      "Boom recruiter asked twice.",
    ]);
  });

  it("caps output at 6 lines", () => {
    const many = ["## A", ...Array.from({ length: 10 }, (_, i) => `- item ${i}`)].join("\n");
    assert.strictEqual(extractCriticalLines(many).length, 6);
  });

  it("returns empty for markdown without sections", () => {
    assert.deepStrictEqual(extractCriticalLines("just text\n- stray bullet"), []);
  });
});
