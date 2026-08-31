#!/usr/bin/env node
/**
 * Entry-path regression net (N2.10).
 *
 * Drives the exact sequence the owner kept hitting, against a running dev
 * server, and asserts the fixes hold:
 *
 *   1. Pair with a FRESH one-time token minted from the running server, land
 *      on the main UI (proves the pairing round-trip works end to end).
 *   2. Click the first employee row: EITHER a thread/composer opens OR a
 *      VISIBLE reason renders (never a silent no-op). On a project-less
 *      install the reason must carry a recovery action.
 *   3. Click the first non-Send Queue action: same guarantee.
 *   4. Pair with a BURNED token (submit the same token twice): the second
 *      attempt must land on a recovery surface with a working path forward,
 *      not a dead-end "Invalid pairing token".
 *
 * Token minting uses the auto-discovering `t3 pair` command so the token is
 * always issued against the state dir the running server actually reads.
 *
 * Usage:
 *   node scripts/entry-path-e2e.mjs [webBaseUrl] [serverBaseUrl]
 * Env:
 *   T3_BIN   path to the built server bin (default apps/server/dist/bin.mjs)
 *   T3_HOME  base-dir passed to token minting (default: auto-discovered)
 *
 * Exits non-zero on any failed assertion so it can gate a release.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const WEB_BASE = process.argv[2] ?? process.env.WEB_BASE ?? "http://localhost:5733";
const T3_BIN = process.env.T3_BIN ?? "apps/server/dist/bin.mjs";
const PLAYWRIGHT_CACHE = join(homedir(), "Library/Caches/ms-playwright");

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

/** Mint a fresh one-time token against the running server. */
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

const failures = [];
function assert(cond, msg) {
  if (cond) console.log(`  \u2713 ${msg}`);
  else {
    console.log(`  \u2717 ${msg}`);
    failures.push(msg);
  }
}

async function main() {
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

    // -- 1. Fresh token -> main UI ---------------------------------------
    console.log("\n== pairing with a fresh token ==");
    const token = mintToken();
    await cdp.send("Page.navigate", { url: `${WEB_BASE}/pair#token=${token}` });
    await sleep(3500);
    const path1 = await evalJs(cdp, "location.pathname");
    assert(!path1.includes("pair"), `landed on main UI (path=${path1})`);

    const ui = await evalJs(
      cdp,
      `(() => ({
      emp: document.querySelectorAll('.emp').length,
      today: !!document.querySelector('[data-testid="today-panel"]'),
    }))()`,
    );
    assert(ui.emp > 0, `Team rail rendered ${ui.emp} employees`);

    // -- 2. Employee click: opens OR visible reason ----------------------
    console.log("\n== clicking the first employee ==");
    const before = await evalJs(cdp, "location.href");
    await evalJs(cdp, `document.querySelector('.emp').click()`);
    await sleep(1500);
    const emp = await evalJs(
      cdp,
      `(() => ({
      urlChanged: location.href !== ${JSON.stringify(before)},
      composer: !!document.querySelector('textarea, [contenteditable="true"], [data-testid*="composer"]'),
      notice: document.querySelector('[data-testid="team-panel-notice"]')?.innerText ?? null,
      action: !!document.querySelector('[data-testid="team-panel-notice"] .team-panel__notice-action'),
    }))()`,
    );
    const empOk = emp.urlChanged || emp.composer || (emp.notice && emp.notice.trim().length > 0);
    assert(
      empOk,
      `employee click did its job OR showed a reason (opened=${emp.urlChanged || emp.composer}, notice=${JSON.stringify(emp.notice)})`,
    );
    if (emp.notice) assert(emp.action, "no-project reason carries a recovery action button");

    // -- 3. Queue action: opens OR visible reason ------------------------
    console.log("\n== clicking the first Queue action ==");
    if (ui.today) {
      const beforeQ = await evalJs(cdp, "location.href");
      const acted = await evalJs(
        cdp,
        `(() => {
        const acts = [...document.querySelectorAll('.today-act')].filter(a => !a.disabled && a.textContent.trim() !== 'Send');
        if (acts.length === 0) return null;
        acts[0].click();
        return acts[0].textContent;
      })()`,
      );
      await sleep(1500);
      const q = await evalJs(
        cdp,
        `(() => ({
        urlChanged: location.href !== ${JSON.stringify(beforeQ)},
        composer: !!document.querySelector('textarea, [contenteditable="true"], [data-testid*="composer"]'),
        notice: document.querySelector('[data-testid="today-panel-notice"]')?.innerText ?? null,
        action: !!document.querySelector('[data-testid="today-panel-notice"] .team-panel__notice-action'),
      }))()`,
      );
      const qOk = q.urlChanged || q.composer || (q.notice && q.notice.trim().length > 0);
      assert(acted !== null, `found an actionable Queue row (action=${JSON.stringify(acted)})`);
      assert(
        qOk,
        `Queue click did its job OR showed a reason (opened=${q.urlChanged || q.composer}, notice=${JSON.stringify(q.notice)})`,
      );
      if (q.notice) assert(q.action, "Queue no-project reason carries a recovery action button");
    } else {
      assert(false, "Queue panel present to test");
    }

    // -- 4. Burned token -> recovery surface, not dead end ---------------
    console.log("\n== pairing with a burned (already-used) token ==");
    const burned = mintToken();
    // Consume it once via the API so the browser's attempt is the second use.
    const consume = await fetch(`${WEB_BASE}/api/auth/browser-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: burned }),
    });
    // First use should succeed (200). If not, the token model changed.
    assert(consume.ok, `first use of the one-time token succeeded (HTTP ${consume.status})`);
    // Fresh browser context: clear cookies so we are unauthenticated again.
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCookies");
    await cdp.send("Page.navigate", { url: `${WEB_BASE}/pair#token=${burned}` });
    await sleep(3500);
    const burnedState = await evalJs(
      cdp,
      `(() => ({
      body: document.body.innerText,
      hasFreshTokenPath: /already used|fresh|npx t3 pair|request a new/i.test(document.body.innerText),
      deadEndOnly: /Invalid pairing token\\. Check the token and try again\\./.test(document.body.innerText),
      hasInput: !!document.querySelector('#pairing-token'),
    }))()`,
    );
    assert(
      burnedState.hasFreshTokenPath,
      "burned-token page offers a working path forward (fresh link guidance)",
    );
    assert(
      !burnedState.deadEndOnly || burnedState.hasFreshTokenPath,
      "burned-token page is not a bare dead-end error",
    );
    assert(burnedState.hasInput, "burned-token page still accepts a fresh token inline");

    proc.kill();
  } catch (e) {
    proc.kill();
    console.error("\nE2E ERROR:", e.message);
    process.exit(1);
  }

  console.log("\n\u2550\u2550 entry-path e2e summary \u2550\u2550");
  if (failures.length) {
    console.error(`FAIL: ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS: pairing + Team + Queue + burned-token recovery all hold.");
  process.exit(0);
}

main();
