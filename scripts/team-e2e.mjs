/**
 * End-to-end acceptance check for the employee layer.
 *
 * Pulls the LIVE payload from a running t3code server and asserts two things
 * that unit tests cannot: every real escalation routes to an owner, and the
 * state model still discriminates (not everyone red, not everyone calm).
 *
 * Usage:
 *   node apps/server/dist/bin.mjs &          # or a dev server on :3773
 *   node scripts/team-e2e.mjs [baseUrl]
 *
 * Exits non-zero on failure so it can gate a release.
 */
import { readFileSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:3773";
const res = await fetch(`${base}/api/today`);
const { nowMarkdown } = await res.json();

// Re-derives routing from the shipped roster source rather than importing TS,
// so this stays dependency-free. If the roster changes, this follows it.
const roster = readFileSync("apps/web/src/components/employees/roster.ts", "utf8");
const blocks = [...roster.matchAll(/id: "(\w+)",\s*keywords: \[([^\]]+)\]/g)].map((m) => ({
  id: m[1],
  kw: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
}));

const sections = {};
let cur = null;
// Mirrors parseNowSections: a bullet owns its soft-wrapped continuation lines,
// otherwise a fragment loses the words that name its owner and reads as unrouted.
let openBullet = false;
for (const line of nowMarkdown.split("\n")) {
  if (line.startsWith("## ")) {
    const h = line.toLowerCase();
    cur = h.includes("critical")
      ? "critical"
      : h.includes("draft")
        ? "drafts"
        : h.includes("decision")
          ? "decisions"
          : h.includes("deadline")
            ? "deadlines"
            : "other";
    sections[cur] ??= [];
    openBullet = false;
    continue;
  }
  if (!cur) continue;
  const b = /^\s*(?:\d+\.|[-*])\s+(.*)$/.exec(line);
  if (b) {
    sections[cur].push(b[1].replace(/\*\*/g, ""));
    openBullet = true;
    continue;
  }
  if (line.trimStart().startsWith("|") && !/^\s*\|[\s|:-]+\|?\s*$/.test(line)) {
    const c = line
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
    if (c.length >= 2 && c[0].toLowerCase() !== "draft") sections[cur].push(c.join(" "));
    openBullet = false;
    continue;
  }
  if (openBullet && /^\s+\S/.test(line)) {
    const last = sections[cur].length - 1;
    sections[cur][last] = `${sections[cur][last]} ${line.trim().replace(/\*\*/g, "")}`;
    continue;
  }
  openBullet = false;
}
const own = (t) => {
  const h = t.toLowerCase();
  return (blocks.find((e) => e.kw.some((k) => h.includes(k))) || {}).id ?? null;
};
let blocking = 0,
  dated = 0,
  unrouted = 0;
const report = {};
for (const e of blocks) {
  const crit = (sections.critical ?? []).filter((t) => own(t) === e.id).length;
  const dr = (sections.drafts ?? []).filter((t) => own(t) === e.id).length;
  const de = (sections.decisions ?? []).filter((t) => own(t) === e.id).length;
  const state = crit > 0 ? "needs-you" : dr + de > 0 ? "dated" : "calm";
  if (state === "needs-you") blocking++;
  else if (state === "dated") dated++;
  report[e.id] = { crit, dr, de, state };
}
for (const k of ["critical", "drafts", "decisions"])
  for (const t of sections[k] ?? []) if (!own(t)) unrouted++;

console.log(JSON.stringify(report, null, 1));
console.log(`blocking=${blocking} dated=${dated} unrouted=${unrouted}`);
if (unrouted > 0) {
  console.error("FAIL: unrouted escalations");
  process.exit(1);
}
if (blocking === 0 || blocking === blocks.length) {
  console.error("FAIL: state does not discriminate");
  process.exit(1);
}
console.log("E2E PASS: every escalation routed, state discriminates");
