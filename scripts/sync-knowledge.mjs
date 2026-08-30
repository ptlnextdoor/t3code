#!/usr/bin/env node
/**
 * Nightly Mac→box sync of derived knowledge artifacts.
 *
 * The Mac rebuilds NOW.md and FRONTS.md every night (a local scheduled job).
 * The remote box runs the t3code server, which reads T3CODE_NOW_MD
 * to serve the TODAY panel. This script pushes the two derived files down to
 * the box so the remote UI shows fresh data instead of a stale manual snapshot.
 *
 * Direction is one-way by design (ARCHITECTURE.md §7): derived artifacts sync
 * DOWN, Mac is source of truth, no merge, and raw personal data (Dayflow
 * sqlite, Gmail tokens, chat DBs) NEVER leaves the Mac. This script only ever
 * touches NOW.md and FRONTS.md.
 *
 * mtime is preserved (rsync --times) on purpose: the box's TodayRoute reports
 * the file's mtime as `nowGeneratedAt`, which drives the staleness banner. If
 * the copy reset mtime to "now", the banner would lie about when the briefing
 * was generated.
 *
 * Failure policy: a briefly-unreachable box is NOT an error. The refresh runs
 * nightly, so a missed push is retried tomorrow. We warn and exit 0 so the
 * surrounding refresh pipeline stays green. Only a genuinely broken invocation
 * (bad args, rsync missing) exits non-zero. A locally-missing source file is
 * skipped with a warning, never fatal.
 *
 * Zero npm dependencies, in the style of scripts/verify.mjs and reap-sessions.mjs.
 *
 * Usage:
 *   node scripts/sync-knowledge.mjs             # push NOW.md + FRONTS.md to the box
 *   node scripts/sync-knowledge.mjs --dry-run   # print what would sync, copy nothing
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** The derived files that are allowed to sync. Nothing else, ever. */
export const ARTIFACTS = ["NOW.md", "FRONTS.md"];

/** Local dir the nightly refresh writes into. */
const LOCAL_DIR = process.env.T3CODE_KNOWLEDGE_DIR ?? join(homedir(), ".jcode/knowledge-org");
/** ssh alias for the box. Always the alias (Tailscale-aware), never a public IP. */
const REMOTE_HOST = process.env.T3CODE_SYNC_HOST ?? "t3code";
/** Dir on the box the t3code service reads NOW.md from (T3CODE_NOW_MD's parent). */
const REMOTE_DIR = process.env.T3CODE_SYNC_DIR ?? "/var/lib/t3code/knowledge-org";

/**
 * Build the list of local source paths that actually exist. Missing files are
 * skipped (warned by the caller), never fatal: a half-built knowledge layer
 * should still sync whatever it has. Pure and dependency-injected for tests.
 */
export function buildSources(artifacts, localDir, exists = existsSync) {
  const present = [];
  const missing = [];
  for (const name of artifacts) {
    const path = join(localDir, name);
    (exists(path) ? present : missing).push({ name, path });
  }
  return { present, missing };
}

/**
 * Classify an rsync/ssh exit code. A connection failure (host down, network
 * unreachable) is a warning we swallow; anything else is a real error.
 * rsync exit 255 is ssh transport failure; 10/12/30/35 are I/O/timeout classes.
 */
export function isUnreachable(code) {
  return code === 255 || code === 30 || code === 35 || code === 10 || code === 12;
}

function log(msg) {
  process.stdout.write(`[sync-knowledge] ${msg}\n`);
}

function main() {
  const dryRun = argv.slice(2).includes("--dry-run");
  const { present, missing } = buildSources(ARTIFACTS, LOCAL_DIR);

  for (const m of missing) {
    log(`WARN missing local file, skipping: ${m.path}`);
  }
  if (present.length === 0) {
    log("nothing to sync (no source files present)");
    return 0;
  }

  const dest = `${REMOTE_HOST}:${REMOTE_DIR}/`;
  // --times preserves mtime (staleness truth); --compress for tiny markdown;
  // -e ssh with a short connect timeout so a down box fails fast, not hangs.
  const args = [
    "--times",
    "--compress",
    "-e",
    "ssh -o ConnectTimeout=15 -o BatchMode=yes",
    ...(dryRun ? ["--dry-run", "--itemize-changes"] : []),
    ...present.map((s) => s.path),
    dest,
  ];

  log(`${dryRun ? "DRY-RUN " : ""}rsync ${present.map((s) => s.name).join(", ")} -> ${dest}`);
  const res = spawnSync("rsync", args, {
    stdio: dryRun ? "inherit" : ["ignore", "ignore", "pipe"],
  });

  if (res.error) {
    // rsync binary itself is missing / not spawnable: a real, fatal misconfig.
    log(`ERROR could not run rsync: ${res.error.message}`);
    return 1;
  }
  if (res.status === 0) {
    if (!dryRun) log(`ok: pushed ${present.length} file(s), mtimes preserved`);
    return 0;
  }
  const stderr = (res.stderr?.toString() ?? "").trim();
  if (isUnreachable(res.status)) {
    log(`WARN box unreachable (rsync exit ${res.status}); nightly retry will catch up`);
    if (stderr) log(`  ${stderr.split("\n")[0]}`);
    return 0; // not an error: refresh pipeline stays green
  }
  log(`ERROR rsync failed (exit ${res.status})`);
  if (stderr) log(`  ${stderr}`);
  return 1;
}

// Only run the effectful sync when invoked directly, so tests can import the
// pure helpers (buildSources, isUnreachable) without triggering process.exit.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  exit(main());
}
