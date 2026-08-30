import { expect, it } from "vite-plus/test";

import { ARTIFACTS, buildSources, isUnreachable } from "./sync-knowledge.mjs";

const DIR = "/home/knowledge-org";

it("builds source paths for every artifact that exists on disk", () => {
  const { present, missing } = buildSources(ARTIFACTS, DIR, () => true);
  expect(present.map((s) => s.name)).toEqual(["NOW.md", "FRONTS.md"]);
  expect(present.map((s) => s.path)).toEqual([
    "/home/knowledge-org/NOW.md",
    "/home/knowledge-org/FRONTS.md",
  ]);
  expect(missing).toEqual([]);
});

it("skips a missing local file instead of failing", () => {
  const exists = (p: string) => p.endsWith("NOW.md"); // FRONTS.md absent
  const { present, missing } = buildSources(ARTIFACTS, DIR, exists);
  expect(present.map((s) => s.name)).toEqual(["NOW.md"]);
  expect(missing.map((s) => s.name)).toEqual(["FRONTS.md"]);
});

it("reports nothing present when the whole knowledge dir is empty", () => {
  const { present, missing } = buildSources(ARTIFACTS, DIR, () => false);
  expect(present).toEqual([]);
  expect(missing.map((s) => s.name)).toEqual(["NOW.md", "FRONTS.md"]);
});

it("treats ssh transport and timeout exit codes as unreachable, not error", () => {
  for (const code of [255, 30, 35, 10, 12]) expect(isUnreachable(code)).toBe(true);
});

it("treats other rsync failures as real errors", () => {
  for (const code of [1, 2, 3, 23]) expect(isUnreachable(code)).toBe(false);
});
