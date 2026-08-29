#!/usr/bin/env node
/**
 * Session reaper: kill abandoned `jcode --resume` processes.
 *
 * The real memory problem, measured on this machine:
 *   - 15.2 GB total RSS on a 24 GB machine, 5.6 GB swapped out.
 *   - 67 jcode processes, 56 of them older than THREE DAYS.
 *   - 30+ of them are DUPLICATE resumes of the same session id, because every
 *     reattach spawns a fresh process and nothing ever reaps the old one.
 *
 * Warp itself is only 0.7 GB. The leak is agent processes that never exit, and
 * it is a leak a remote box would only relocate, not fix. Fix it locally first.
 *
 * Safety: never touches the shared server, never touches this session, and
 * defaults to a dry run. Only `--kill` actually sends a signal.
 *
 * Usage:
 *   node scripts/reap-sessions.mjs              # report only
 *   node scripts/reap-sessions.mjs --kill       # reap duplicates + stale
 *   node scripts/reap-sessions.mjs --kill --max-age-hours 48
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const DO_KILL = args.includes("--kill");
// Parse carefully: `Number(undefined)` and `Number("--kill")` are both NaN, and
// `NaN ?? fallback` does NOT fall back (NaN is neither null nor undefined). An
// earlier version had exactly that bug, which silently disabled the entire
// staleness check, so only duplicates were ever reaped.
const ageFlagIndex = args.indexOf("--max-age-hours");
const parsedAge = ageFlagIndex >= 0 ? Number(args[ageFlagIndex + 1]) : Number.NaN;
const MAX_AGE_HOURS = Number.isFinite(parsedAge) ? parsedAge : 24;

/** Parse `ps` etime (`[[dd-]hh:]mm:ss`) into hours. */
function etimeToHours(etime) {
  let days = 0;
  let rest = etime;
  if (rest.includes("-")) {
    const [d, r] = rest.split("-");
    days = Number(d);
    rest = r;
  }
  const parts = rest.split(":").map(Number);
  const [h, m] = parts.length === 3 ? [parts[0], parts[1]] : [0, parts[0]];
  return days * 24 + h + m / 60;
}

const raw = execFileSync("ps", ["-eo", "pid,etime,rss,command"], { encoding: "utf8" });
const procs = [];
for (const line of raw.split("\n").slice(1)) {
  const m = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(line);
  if (!m) continue;
  const [, pid, etime, rss, command] = m;
  if (!command.includes(".jcode/builds")) continue;
  // The shared server is infrastructure, not an abandoned session.
  if (command.includes("serve")) continue;
  const resume = /--resume\s+(\S+)/.exec(command);
  if (!resume) continue;
  procs.push({
    ageHours: etimeToHours(etime),
    command,
    etime,
    pid: Number(pid),
    rssMb: Number(rss) / 1024,
    session: resume[1],
  });
}

// Never reap the process running this very script's session.
const selfSession = process.env.JCODE_SESSION_ID ?? "";

const bySession = new Map();
for (const p of procs) {
  if (!bySession.has(p.session)) bySession.set(p.session, []);
  bySession.get(p.session).push(p);
}

const doomed = [];
for (const [session, list] of bySession) {
  list.sort((a, b) => a.ageHours - b.ageHours); // newest first
  // Duplicates: one live process per session is enough; older copies are dead
  // reattaches holding memory for nothing.
  for (const p of list.slice(1)) doomed.push({ ...p, why: "duplicate" });
  // The survivor still goes if it is simply too old to be a live conversation.
  const keep = list[0];
  if (keep.ageHours > MAX_AGE_HOURS && session !== selfSession) {
    doomed.push({ ...keep, why: `stale >${MAX_AGE_HOURS}h` });
  }
}

const totalMb = procs.reduce((s, p) => s + p.rssMb, 0);
const reclaimMb = doomed.reduce((s, p) => s + p.rssMb, 0);

console.log(`jcode session processes: ${procs.length} using ${(totalMb / 1024).toFixed(2)} GB`);
console.log(`distinct sessions:       ${bySession.size}`);
console.log(
  `reapable:                ${doomed.length} processes, ${(reclaimMb / 1024).toFixed(2)} GB`,
);
for (const p of doomed.slice(0, 12)) {
  console.log(
    `  pid ${p.pid}  ${p.etime.padStart(11)}  ${p.rssMb.toFixed(0).padStart(5)}MB  ${p.why}  ${p.session.slice(0, 44)}`,
  );
}
if (doomed.length > 12) console.log(`  ... and ${doomed.length - 12} more`);

if (!DO_KILL) {
  console.log("\nDry run. Re-run with --kill to reap.");
  process.exit(0);
}

let killed = 0;
for (const p of doomed) {
  try {
    process.kill(p.pid, "SIGTERM");
    killed++;
  } catch {
    // Already gone between listing and killing; that is fine.
  }
}
console.log(`\nReaped ${killed} processes, ~${(reclaimMb / 1024).toFixed(2)} GB reclaimed.`);
