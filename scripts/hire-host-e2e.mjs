#!/usr/bin/env node
/**
 * HIRE + HOST acceptance (N3.9).
 *
 * Proves the owner's "I can create my own bot" loop end to end, against a
 * running dev server whose T3CODE_ROSTER_JSON points at a TEMP file (never the
 * owner's real ~/.t3/superapp/roster.json). Two modes:
 *
 *   1. FAST (default, no browser) — needs only a running server + a temp roster:
 *        a. POST /api/roster/employee hires an employee.
 *        b. The temp roster.json on disk now contains it.
 *        c. A second POST with the same id is refused (409), so an append can
 *           never clobber.
 *      This is the CI-safe gate: it drives the exact server surface the dialog
 *      talks to, and asserts the disk write the acceptance loop depends on.
 *
 *   2. BROWSER (HIRE_HOST_E2E_BROWSER=1) — the full UI pass, modeled on
 *      melani-shell-e2e: pair with a fresh token, open the + New employee
 *      dialog, fill it, submit, and assert the new row appears; then read the
 *      temp roster.json and assert it contains the hire; then click the row and
 *      assert a conversation opens (local-host case); then seed a remote-host
 *      employee whose environment is not connected, reload, click it, and assert
 *      the OFFLINE notice renders (the remote path, provable without a live box).
 *      Screenshots: the hire dialog, the sidebar with the new employee, and the
 *      offline notice.
 *
 * Env:
 *   HIRE_HOST_BASE            server/web base url (default http://localhost:3773)
 *   T3CODE_ROSTER_JSON        REQUIRED: the temp roster file the server reads/writes.
 *                             The script refuses to run against a path under
 *                             ~/.t3/superapp to protect the owner's real roster.
 *   HIRE_HOST_E2E_BROWSER=1   also run the browser pass (needs Chrome + web app).
 *   T3_BIN                    built server bin for token minting (browser mode).
 *   SHOT_DIR                  screenshot dir (default ./.hire-host-shots).
 *
 * Exits non-zero on any failed assertion so it can gate the node.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const BASE = process.env.HIRE_HOST_BASE ?? process.argv[2] ?? "http://localhost:3773";
const ROSTER_PATH = process.env.T3CODE_ROSTER_JSON;
const SHOT_DIR = process.env.SHOT_DIR ?? ".hire-host-shots";
const T3_BIN = process.env.T3_BIN ?? "apps/server/dist/bin.mjs";
const PLAYWRIGHT_CACHE = join(homedir(), "Library/Caches/ms-playwright");

const failures = [];
function assert(cond, msg) {
  if (cond) console.log(`  \u2713 ${msg}`);
  else {
    console.log(`  \u2717 ${msg}`);
    failures.push(msg);
  }
}

// ── Safety: never touch the owner's real roster ─────────────────────────────
if (!ROSTER_PATH) {
  console.error(
    "REFUSING TO RUN: set T3CODE_ROSTER_JSON to a TEMP file the dev server reads,\n" +
      "  e.g. T3CODE_ROSTER_JSON=$(mktemp -d)/roster.json, and start the server with it.",
  );
  process.exit(2);
}
if (ROSTER_PATH.includes(join(".t3", "superapp"))) {
  console.error(`REFUSING TO RUN: T3CODE_ROSTER_JSON (${ROSTER_PATH}) looks like the real roster.`);
  process.exit(2);
}

const readRoster = () => {
  try {
    return JSON.parse(readFileSync(ROSTER_PATH, "utf8"));
  } catch {
    return null;
  }
};

// ── 1. FAST: endpoint + disk (CI-safe) ──────────────────────────────────────

async function fastPass() {
  console.log("\n== FAST: POST /api/roster/employee -> disk ==");
  // A unique id per run so a re-run against a persistent temp file still hires.
  const id = `e2e-${Date.now()}`;
  const employee = {
    id,
    name: `E2E ${id}`,
    role: "Proves the hire loop writes to disk.",
    keywords: ["e2e", "hire"],
  };

  const res = await fetch(`${BASE}/api/roster/employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(employee),
  });
  const body = await res.json().catch(() => ({}));
  assert(res.ok && body.ok, `hire POST accepted (status=${res.status})`);

  const roster = readRoster();
  assert(Array.isArray(roster), "temp roster.json is a JSON array on disk");
  assert(
    Array.isArray(roster) && roster.some((e) => e.id === id),
    `roster.json on disk contains the new employee "${id}"`,
  );

  // Duplicate id must be refused, never clobber.
  const dupRes = await fetch(`${BASE}/api/roster/employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(employee),
  });
  assert(dupRes.status === 409, `duplicate id refused with 409 (got ${dupRes.status})`);

  // A remote-host hire round-trips the host field to disk.
  const remoteId = `${id}-remote`;
  await fetch(`${BASE}/api/roster/employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: remoteId,
      name: "E2E Remote",
      role: "Runs on a remote host.",
      host: "env-e2e-remote",
    }),
  });
  const withRemote = readRoster();
  const remote = Array.isArray(withRemote) ? withRemote.find((e) => e.id === remoteId) : null;
  assert(remote?.host === "env-e2e-remote", "a remote-host hire persists its host to disk");
}

// ── 2. BROWSER: full UI pass (opt-in) ───────────────────────────────────────

function findChrome() {
  const explicit = process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  if (existsSync(PLAYWRIGHT_CACHE)) {
    const dirs = readdirSync(PLAYWRIGHT_CACHE)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse();
    const subs = [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const d of dirs)
      for (const sub of subs) {
        const p = join(PLAYWRIGHT_CACHE, d, sub);
        if (existsSync(p)) return p;
      }
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chrome)) return chrome;
  throw new Error("No Chrome binary found. Set CHROME_PATH.");
}

function mintToken() {
  const out = execFileSync("node", [T3_BIN, "pair"], { encoding: "utf8" });
  const m = out.match(/^Token:\s*(\S+)/m);
  if (!m) throw new Error("could not mint token; is a dev server running?\n" + out);
  return m[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id) return;
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

async function connectCdp(port) {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
    await sleep(150);
  }
  if (!target) throw new Error("no devtools endpoint");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cdp socket failed")), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return { cdp, ws };
}

async function evalJs(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const path = join(SHOT_DIR, `${name}.png`);
  writeFileSync(path, Buffer.from(data, "base64"));
  console.log(`  \u{1f4f8} ${path}`);
}

async function browserPass() {
  console.log("\n== BROWSER: hire dialog + row + open + offline notice ==");
  mkdirSync(SHOT_DIR, { recursive: true });
  const port = 9222 + Math.floor(Math.random() * 500);
  const proc = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${port}`,
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const { cdp } = await connectCdp(port);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const token = mintToken();
    await cdp.send("Page.navigate", { url: `${BASE}/pair#token=${token}` });
    await sleep(4000);

    // Open the hire dialog.
    await evalJs(cdp, `document.querySelector('[data-testid="melani-hire"]')?.click()`);
    await sleep(700);
    const dialogOpen = await evalJs(
      cdp,
      `!!document.querySelector('[data-testid="melani-hire-dialog"]')`,
    );
    assert(dialogOpen, "the + New employee dialog opens");
    await screenshot(cdp, "hire-dialog");

    // Fill and submit.
    const hireName = `Scout ${Date.now()}`;
    const setInput = (testId, value) =>
      evalJs(
        cdp,
        `(() => {
          const el = document.querySelector('[data-testid="${testId}"]');
          if (!el) return false;
          const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`,
      );
    await setInput("melani-hire-name", hireName);
    await setInput("melani-hire-role", "Scouts new opportunities and reports back.");
    await setInput("melani-hire-keywords", "scout, lead, opportunity");
    await sleep(200);
    await evalJs(cdp, `document.querySelector('[data-testid="melani-hire-submit"]').click()`);

    // The new row appears.
    let rowNames = [];
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      rowNames = await evalJs(
        cdp,
        `[...document.querySelectorAll('[data-testid="melani-employee-row"] .melani-row__name')].map((n) => n.textContent)`,
      );
      if (rowNames.some((n) => n.includes(hireName))) break;
    }
    assert(
      rowNames.some((n) => n.includes(hireName)),
      `the new employee "${hireName}" appears in the sidebar`,
    );
    await screenshot(cdp, "sidebar-new-employee");

    // roster.json on disk contains it (dev server wrote to the temp file).
    const roster = readRoster();
    assert(
      Array.isArray(roster) && roster.some((e) => e.name === hireName),
      "roster.json on disk contains the dialog-created employee",
    );

    // Clicking a LOCAL employee opens a conversation.
    const before = await evalJs(cdp, "location.href");
    await evalJs(
      cdp,
      `[...document.querySelectorAll('[data-testid="melani-employee-row"]')]
        .find((r) => r.textContent.includes(${JSON.stringify(hireName)}))?.click()`,
    );
    let opened = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      opened = await evalJs(
        cdp,
        `location.href !== ${JSON.stringify(before)} || !!document.querySelector('textarea, [contenteditable="true"], [data-testid*="composer"]')`,
      );
      if (opened) break;
    }
    assert(opened, "clicking a local-host employee opens a conversation");

    // OFFLINE path: seed a remote-host employee whose environment is unknown, so
    // the client cannot connect to it. Refresh the roster and click it: the
    // offline notice must render (provable with no live remote box).
    const current = readRoster() ?? [];
    const remoteName = `Remote ${Date.now()}`;
    writeFileSync(
      ROSTER_PATH,
      `${JSON.stringify(
        [
          ...current,
          {
            id: `remote-${Date.now()}`,
            name: remoteName,
            role: "Runs on a server that is not connected.",
            keywords: [],
            topics: [],
            host: "env-unreachable-e2e",
          },
        ],
        null,
        2,
      )}\n`,
    );
    // Nudge the client to re-fetch the roster, then click the remote employee.
    await evalJs(cdp, `window.dispatchEvent(new Event('t3code:roster-refresh'))`);
    let clicked = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      clicked = await evalJs(
        cdp,
        `(() => {
          const row = [...document.querySelectorAll('[data-testid="melani-employee-row"]')]
            .find((r) => r.textContent.includes(${JSON.stringify(remoteName)}));
          if (!row) return false;
          row.click();
          return true;
        })()`,
      );
      if (clicked) break;
    }
    assert(clicked, "the remote-host employee row appears after a roster refresh");

    let noticeShown = false;
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      noticeShown = await evalJs(
        cdp,
        `!!document.querySelector('[data-testid="melani-offline-notice"]')`,
      );
      if (noticeShown) break;
    }
    assert(noticeShown, "clicking an offline remote-host employee shows the reconnect notice");
    if (noticeShown) await screenshot(cdp, "offline-notice");

    proc.kill();
  } catch (e) {
    proc.kill();
    console.error("\nBROWSER E2E ERROR:", e.message);
    failures.push(`browser error: ${e.message}`);
  }
}

// ── run ─────────────────────────────────────────────────────────────────────

await fastPass();
if (process.env.HIRE_HOST_E2E_BROWSER === "1") {
  await browserPass();
} else {
  console.log("\n(browser pass skipped; set HIRE_HOST_E2E_BROWSER=1 with a dev server to run it)");
}

console.log("\n\u2550\u2550 hire-host e2e summary \u2550\u2550");
if (failures.length) {
  console.error(`FAIL: ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("PASS: hire writes to disk, dup is refused, host round-trips.");
process.exit(0);
