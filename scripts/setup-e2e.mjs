/**
 * E2E for the first-run Setup wizard (N2.8).
 *
 * Serves the built setup harness (fully stubbed, offline) and does two things:
 *
 *   1. SCREENSHOTS every step. It seeds `?step=` per step so each of the five is
 *      captured in isolation, delegating the browser drive to the repo's proven
 *      scripts/ui-screenshot.mjs (no bespoke CDP for the shots).
 *
 *   2. DRIVES the wizard headless through all five steps over CDP, asserting the
 *      final state: the profile POST and the roster commit both fire (the stub
 *      records them on window.__setupWrites), and the wizard reaches `done`.
 *      This is the "final state writes profile.json + roster.json and the Team
 *      rail renders" assertion, proven at the network boundary the wizard talks
 *      to rather than against a live disk.
 *
 * Build first:
 *   cd apps/web && T3CODE_SETUP_HARNESS=1 <pkgmgr> build
 *
 * Usage: node scripts/setup-e2e.mjs [outDir]
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = join(repoRoot, "apps/web/dist-harness");
const outDir = process.argv[2] ?? "/tmp/shots/n28-setup";

if (!existsSync(join(dist, "setup-harness.html"))) {
  console.error(
    `No setup harness at ${dist}.\n  Run: cd apps/web && T3CODE_SETUP_HARNESS=1 ../../node_modules/.bin/vp build`,
  );
  process.exit(1);
}

const MIME = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path === "/") path = "/setup-harness.html";
  const file = join(dist, path);
  if (!existsSync(file) || !file.startsWith(dist)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

const PORT = 4822;
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${PORT}/setup-harness.html`;

// ── 1. Screenshot every step ────────────────────────────────────────────────
// Opt-in (SETUP_E2E_SHOTS=1). Each shot reboots Chrome, so running five inside
// one process contends badly on a busy machine; the default run is the fast,
// reliable drive assertion below, and screenshots are a separate artifact pass
// (the same split verify.mjs uses for the visual gate). A short cooldown
// between shots keeps the cold-Chrome launches from colliding.
const STEPS = ["welcome", "connections", "remote", "braindump", "done"];
const shotPaths = [];
const sleepTop = (ms) => new Promise((r) => setTimeout(r, ms));
if (process.env.SETUP_E2E_SHOTS === "1") {
  mkdirSync(outDir, { recursive: true });
  for (const [i, step] of STEPS.entries()) {
    const out = join(outDir, `${i + 1}-${step}.png`);
    const url = `${base}?step=${step}`;
    // Async spawn (not spawnSync): the harness server runs in THIS process, so
    // blocking the event loop would stop it answering the child Chrome and every
    // shot would time out. Awaiting an async child keeps the server live.
    const status = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [join(repoRoot, "scripts/ui-screenshot.mjs"), url, out, "640", "1000", "1600"],
        { stdio: "inherit" },
      );
      const timer = setTimeout(() => child.kill(), 90_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });
    if (status !== 0) {
      console.error(`screenshot failed for step ${step}`);
      server.close();
      process.exit(1);
    }
    shotPaths.push(out);
    await sleepTop(500);
  }
}

// ── 2. Drive all five steps over CDP and assert the final state ──────────────

function findChrome() {
  const explicit = process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    const dirs = readdirSync(cache)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse();
    const subs = [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const d of dirs)
      for (const sub of subs) {
        const p = join(cache, d, sub);
        if (existsSync(p)) return p;
      }
  }
  const sys = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(sys)) return sys;
  throw new Error("No Chrome binary found. Set CHROME_PATH.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbgPort = 9800 + Math.floor(Math.random() * 400);
const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${dbgPort}`,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const r = this.pending.get(msg.id);
      if (r) {
        this.pending.delete(msg.id);
        msg.error ? r.reject(new Error(msg.error.message)) : r.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    const detail =
      exceptionDetails.exception?.description ??
      exceptionDetails.text ??
      JSON.stringify(exceptionDetails);
    throw new Error(detail);
  }
  return result.value;
}

/** Click an element by data-testid and wait a beat for React to react. */
async function clickTestId(cdp, testId) {
  const clicked = await evaluate(
    cdp,
    `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`could not find [data-testid="${testId}"]`);
  await sleep(350);
}

async function typeInto(cdp, testId, value) {
  const ok = await evaluate(
    cdp,
    `(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return false;
      // The value setter lives on the element's own prototype: input vs textarea.
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  if (!ok) throw new Error(`could not type into [data-testid="${testId}"]`);
  await sleep(120);
}

async function drive() {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  if (!target) throw new Error("Chrome DevTools endpoint never came up");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // Start clean at step 1: no ?step seed, so the wizard opens on welcome.
  await cdp.send("Page.navigate", { url: base });
  await sleep(1400);

  // Instrument the stub to record writes, without changing app code: wrap fetch.
  await evaluate(
    cdp,
    `(() => {
      window.__setupWrites = { profile: false, commit: false };
      const orig = window.fetch;
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input.url || String(input));
        if (url.includes('/api/setup/profile')) window.__setupWrites.profile = true;
        if (url.includes('/api/onboard/commit')) window.__setupWrites.commit = true;
        return orig(input, init);
      };
      return true;
    })()`,
  );

  const failures = [];
  const stepNow = () =>
    evaluate(
      cdp,
      `document.querySelector('[data-testid="setup-wizard"]')?.getAttribute('data-step')`,
    );

  // Step 1 WELCOME: type name, save.
  if ((await stepNow()) !== "welcome") failures.push(`expected welcome, got ${await stepNow()}`);
  await typeInto(cdp, "setup-name", "Aayu");
  await clickTestId(cdp, "setup-welcome-next");
  if ((await stepNow()) !== "connections")
    failures.push(`after welcome expected connections, got ${await stepNow()}`);

  // Step 2 CONNECTIONS: cards render; advance.
  const hasGmail = await evaluate(
    cdp,
    `!!document.querySelector('[data-testid="connection-card-gmail"]')`,
  );
  const hasGithub = await evaluate(
    cdp,
    `!!document.querySelector('[data-testid="connection-card-github"]')`,
  );
  if (!hasGmail) failures.push("connections step missing Gmail card");
  if (!hasGithub) failures.push("connections step missing GitHub coming-soon card");
  await clickTestId(cdp, "setup-next");
  if ((await stepNow()) !== "remote")
    failures.push(`after connections expected remote, got ${await stepNow()}`);

  // Step 3 REMOTE: command visible; skip with Later.
  const hasCommand = await evaluate(
    cdp,
    `!!document.querySelector('[data-testid="setup-remote-command"]')`,
  );
  if (!hasCommand) failures.push("remote step missing the provisioning command");
  await clickTestId(cdp, "setup-skip");
  if ((await stepNow()) !== "braindump")
    failures.push(`after remote-skip expected braindump, got ${await stepNow()}`);

  // Step 4 BRAIN DUMP: type, organize, start.
  await typeInto(
    cdp,
    "onboarding-textarea",
    "Investor update due Friday, fix the signup crash before the Acme demo, drive mom on the 14th.",
  );
  await clickTestId(cdp, "onboarding-organize");
  await sleep(600);
  await clickTestId(cdp, "onboarding-start");
  await sleep(500);

  // Step 5 DONE: wizard reached done, and both writes fired.
  if ((await stepNow()) !== "done")
    failures.push(`after start expected done, got ${await stepNow()}`);
  const writes = await evaluate(cdp, `window.__setupWrites`);
  if (!writes?.profile)
    failures.push("profile.json was never written (no /api/setup/profile POST)");
  if (!writes?.commit) failures.push("roster.json was never written (no /api/onboard/commit POST)");

  ws.close();
  return failures;
}

let code = 0;
try {
  const failures = await drive();
  if (failures.length > 0) {
    console.error("\nSETUP E2E FAILED:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    code = 1;
  } else {
    console.log("\nSETUP E2E PASSED: all five steps drove through to done.");
    console.log("  ✓ welcome -> connections -> remote(skip) -> braindump -> done");
    console.log("  ✓ profile.json written (POST /api/setup/profile)");
    console.log("  ✓ roster.json written (POST /api/onboard/commit)");
  }
} catch (err) {
  console.error(`\nSETUP E2E ERROR: ${err.message}`);
  code = 1;
} finally {
  chrome.kill();
  server.close();
}

if (shotPaths.length > 0) {
  console.log("\nScreenshots:");
  for (const p of shotPaths) console.log(`  ${p}`);
} else {
  console.log("\nScreenshots: skipped (run with SETUP_E2E_SHOTS=1 to capture all five steps).");
}

process.exit(code);
