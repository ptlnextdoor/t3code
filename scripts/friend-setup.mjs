#!/usr/bin/env node
/**
 * friend-setup — the one command a stranger runs after cloning.
 *
 * A friend with a fresh Mac clones the repo and runs `node scripts/friend-setup.mjs`.
 * This checks the few prerequisites, installs dependencies, starts the dev
 * server, and tells them the single URL to open. First run there greets them
 * with the setup wizard.
 *
 * Design rules, in the spirit of scripts/verify.mjs:
 *   - Zero npm dependencies. Node built-ins only.
 *   - Idempotent and re-runnable: safe to run twice, skips install if it can.
 *   - Calm output. This is the first thing a stranger sees, so no wall of text
 *     and no stack traces — a missing prerequisite prints one line and the exact
 *     command to fix it.
 *
 * It does NOT configure Google, a remote box, or an AI model. Those are steps
 * inside the wizard, every one skippable. This script's only job is to get the
 * app running and hand over a URL.
 *
 * Usage:
 *   node scripts/friend-setup.mjs            # install (if needed) + start dev
 *   node scripts/friend-setup.mjs --check    # only run the prerequisite checks
 *   node scripts/friend-setup.mjs --no-start # install, then stop (don't boot)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_NODE_MAJOR = 24;

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const NO_START = args.has("--no-start");

/** Small ANSI helpers; degrade to plain text when output is not a TTY. */
const tty = process.stdout.isTTY;
const dim = (s) => (tty ? `\u001b[2m${s}\u001b[0m` : s);
const bold = (s) => (tty ? `\u001b[1m${s}\u001b[0m` : s);
const green = (s) => (tty ? `\u001b[32m${s}\u001b[0m` : s);
const yellow = (s) => (tty ? `\u001b[33m${s}\u001b[0m` : s);
const red = (s) => (tty ? `\u001b[31m${s}\u001b[0m` : s);

function say(line = "") {
  console.log(line);
}

/** Is a binary on PATH? Returns its version line, or null when missing. */
function probe(bin, versionArgs = ["--version"]) {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  if (which.status !== 0 || which.stdout.trim().length === 0) return null;
  const v = spawnSync(bin, versionArgs, { encoding: "utf8" });
  return (v.stdout || v.stderr || "").trim().split("\n")[0] ?? "";
}

/**
 * Check the three things a fresh clone needs. Returns a list of problems, each
 * with the one-liner that fixes it. An empty list means we are good to go.
 */
function checkPrerequisites() {
  const problems = [];

  // Node: the repo needs >= 24. We are obviously running under *some* node, so
  // just check this one is new enough.
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    problems.push({
      what: `Node ${MIN_NODE_MAJOR}+ (you have ${process.version})`,
      fix: "Install from https://nodejs.org  (or: brew install node)",
    });
  } else {
    say(`  ${green("\u2713")} Node ${process.version}`);
  }

  // pnpm: the repo's package manager. Node 24 ships corepack, so the friendly
  // fix is a corepack enable rather than a global npm install.
  const pnpm = probe("pnpm");
  if (pnpm === null) {
    problems.push({
      what: "pnpm (the package manager this repo uses)",
      fix: "corepack enable pnpm   (or: npm install -g pnpm)",
    });
  } else {
    say(`  ${green("\u2713")} pnpm ${pnpm}`);
  }

  // git: only needed if they want to pull updates later, but a clone implies it.
  const git = probe("git");
  if (git === null) {
    problems.push({
      what: "git",
      fix: "xcode-select --install   (installs git on macOS)",
    });
  } else {
    say(`  ${green("\u2713")} ${git}`);
  }

  return problems;
}

/** Run a command to completion, streaming its output. Resolves with exit code. */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, cmdArgs, { cwd: REPO_ROOT, stdio: "inherit", ...opts });
    proc.on("error", (err) => {
      say(red(`  could not start "${cmd}": ${err.message}`));
      resolve(1);
    });
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Install dependencies. Prefer pnpm (the declared package manager). In a fresh
 * clone the repo's `vp` binary does not exist yet, so `pnpm install` is the
 * correct first move; it also runs the repo's prepare step which sets `vp` up.
 * Idempotent: pnpm is a no-op when the store is already satisfied.
 */
async function install() {
  say(`\n${bold("Installing dependencies")} ${dim("(first run takes a few minutes)")}`);
  const code = await run("pnpm", ["install"]);
  if (code !== 0) {
    say(
      red(
        "\nInstall failed. Scroll up for the reason — usually a network hiccup; re-run to retry.",
      ),
    );
    return false;
  }
  return true;
}

/**
 * Start the dev server and wait until it prints the port it bound. The
 * dev-runner logs one line like:
 *   [dev-runner] mode=dev source=... serverPort=13773 webPort=5733 baseDir=...
 * We watch for that, print the friendly open-me URL, then keep the server in
 * the foreground so the friend can Ctrl-C it when they are done.
 */
function startDev() {
  say(`\n${bold("Starting the app")} ${dim("(leave this running; Ctrl-C to stop)")}\n`);

  const proc = spawn("pnpm", ["run", "dev"], { cwd: REPO_ROOT });
  let announced = false;

  const onChunk = (buf) => {
    const text = buf.toString();
    process.stdout.write(text); // pass the real logs through
    if (announced) return;
    const match = text.match(/webPort=(\d+)/);
    if (match) {
      announced = true;
      const url = `http://localhost:${match[1]}`;
      // Give the web server a beat to finish binding before we shout the URL.
      setTimeout(() => announce(url), 1500);
    }
  };

  proc.stdout.on("data", onChunk);
  proc.stderr.on("data", onChunk);

  proc.on("error", (err) => {
    say(red(`\nCould not start the dev server: ${err.message}`));
    process.exit(1);
  });
  proc.on("close", (code) => process.exit(code ?? 0));

  // Forward Ctrl-C so the child shuts down cleanly.
  const stop = () => {
    proc.kill("SIGINT");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function announce(url) {
  const line = "\u2500".repeat(48);
  say(`\n${green(line)}`);
  say(`  ${bold("Open")} ${bold(green(url))}`);
  say("  The setup wizard will greet you there.");
  say(`  ${dim("First step asks about connections — every step is skippable.")}`);
  say(`${green(line)}\n`);
}

async function main() {
  say(bold("\nt3code — friend setup\n"));
  say("Checking what you have installed:");

  const problems = checkPrerequisites();
  if (problems.length > 0) {
    say(`\n${yellow("A couple of things are missing:")}`);
    for (const p of problems) {
      say(`  ${red("\u2717")} ${p.what}`);
      say(`    ${dim("fix:")} ${p.fix}`);
    }
    say(`\nInstall those, then run this again:  ${bold("node scripts/friend-setup.mjs")}\n`);
    process.exit(1);
  }

  if (CHECK_ONLY) {
    say(`\n${green("All prerequisites met.")} Run without --check to install and start.\n`);
    process.exit(0);
  }

  // A fresh clone has no node_modules; anything else is a re-run, where install
  // is a cheap no-op we still do to catch a partial previous run.
  const freshClone = !existsSync(join(REPO_ROOT, "node_modules"));
  say(
    freshClone ? "\nLooks like a fresh clone." : dim("\nDependencies already present; verifying."),
  );

  const installed = await install();
  if (!installed) process.exit(1);

  if (NO_START) {
    say(`\n${green("Ready.")} Start the app any time with:  ${bold("pnpm run dev")}\n`);
    process.exit(0);
  }

  startDev();
}

main().catch((err) => {
  say(red(`\nUnexpected error: ${err?.message ?? err}`));
  process.exit(1);
});
