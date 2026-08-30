#!/usr/bin/env node
/**
 * Single-command verification wrapper for the four swarm gates.
 *
 * Runs the repo's verification gates in sequence, stops on the first failure,
 * and prints one clean pass/fail summary. Exits non-zero if any gate fails, so
 * it can gate a merge. Zero npm dependencies, in the style of ui-screenshot.mjs.
 *
 * Gates (in order):
 *   1. Types    — pnpm typecheck                 (0 errors)
 *   2. Tests    — pnpm --filter web test         (web unit tests)
 *               — pnpm --filter t3 test          (server tests)
 *   3. Routing  — node scripts/team-e2e.mjs      (0 unrouted; needs a running
 *                                                 server on :3773)
 *
 * The visual gate (node scripts/ui-screenshot.mjs) is NOT run pass/fail here:
 * a screenshot can only be judged by a human eyeballing the PNG. We print the
 * command and output path instead.
 *
 * Usage:
 *   node scripts/verify.mjs
 */
import { spawn } from "node:child_process";

const SHOT_OUT = "artifacts/verify-ui.png";
const SHOT_URL = process.env.VERIFY_UI_URL ?? "http://localhost:3773";

// Each gate is one command run from the repo root. First failure stops the run.
const gates = [
  { name: "types", label: "pnpm typecheck", cmd: "pnpm", args: ["typecheck"] },
  {
    name: "test:web",
    label: "pnpm --filter web test",
    cmd: "pnpm",
    args: ["--filter", "web", "test"],
  },
  {
    name: "test:server",
    label: "pnpm --filter t3 test",
    cmd: "pnpm",
    args: ["--filter", "t3", "test"],
  },
  {
    name: "routing",
    label: "node scripts/team-e2e.mjs",
    cmd: "node",
    args: ["scripts/team-e2e.mjs"],
  },
];

/** Run one command, inheriting stdio so its output streams live. */
function run({ cmd, args }) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("error", (err) => {
      console.error(`\n  could not start "${cmd}": ${err.message}`);
      resolve(1);
    });
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

const results = [];
let failedAt = null;

for (const gate of gates) {
  console.log(`\n\u2500\u2500 ${gate.name}: ${gate.label} \u2500\u2500`);
  const code = await run(gate);
  const ok = code === 0;
  results.push({ ...gate, ok });
  if (!ok) {
    failedAt = gate;
    break; // stop on first failure
  }
}

console.log("\n\u2550\u2550 verify summary \u2550\u2550");
for (const gate of gates) {
  const r = results.find((x) => x.name === gate.name);
  const mark = !r ? "\u25cb SKIP" : r.ok ? "\u2713 PASS" : "\u2717 FAIL";
  console.log(`  ${mark}  ${gate.name.padEnd(12)} ${gate.label}`);
}

// Visual gate is human-judged, never pass/fail here.
console.log(
  `  \u25c9 EYEBALL  visual       node scripts/ui-screenshot.mjs ${SHOT_URL} ${SHOT_OUT}`,
);
console.log(`             \u21b3 run it, then a human must eyeball ${SHOT_OUT}`);

if (failedAt) {
  console.error(`\nFAIL: gate "${failedAt.name}" (${failedAt.label}) failed. Stopped.`);
  process.exit(1);
}
console.log("\nPASS: all automated gates green. Visual gate still needs a human.");
process.exit(0);
