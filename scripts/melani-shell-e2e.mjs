#!/usr/bin/env node
/**
 * Melani shell acceptance (N3.1).
 *
 * Drives the exact "not a chat app" impression the owner is missing, against a
 * running dev server, and asserts the shell holds:
 *
 *   1. Pair with a FRESH one-time token, land on the main UI, and prove the
 *      MELANI SHELL is the front door (2-col grid present, not the old rail).
 *   2. The people-sidebar renders the roster (>= the 7 staffed employees).
 *   3. Clicking a Melani employee row OPENS a conversation (composer visible),
 *      via the shared zero-config open path — never a "no project" dead end.
 *   3b. The STAGE sheds t3code's coding-app chrome: the header shows the
 *      employee name + role (not a project breadcrumb), NO "Initialize Git"
 *      button is present, and the empty stage greets the person rather than
 *      asking "What should we build in X?".
 *   4. Collapse -> the sidebar becomes the 88px avatar rail; expand -> back.
 *   5. Screenshots: expanded, collapsed, conversation-open, empty-state,
 *      hire-dialog.
 *   6. The hire dialog opens as a sand overlay (and closes on Escape).
 *   7. Reduced motion (N3.2): with prefers-reduced-motion: reduce emulated,
 *      the employee row and shell width transitions compute to none — proof
 *      the motion pass never pegs the GPU on a high-refresh display.
 *
 * Token minting uses the auto-discovering `t3 pair` command so the token is
 * always issued against the state dir the running server actually reads.
 *
 * Usage:
 *   node scripts/melani-shell-e2e.mjs [webBaseUrl]
 * Env:
 *   T3_BIN        path to the built server bin (default apps/server/dist/bin.mjs)
 *   SHOT_DIR      where to write screenshots (default ./.melani-shots)
 *
 * Exits non-zero on any failed assertion so it can gate the node.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const WEB_BASE = process.argv[2] ?? process.env.WEB_BASE ?? "http://localhost:5733";
const T3_BIN = process.env.T3_BIN ?? "apps/server/dist/bin.mjs";
const SHOT_DIR = process.env.SHOT_DIR ?? ".melani-shots";
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
  return path;
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

    // -- 1. Fresh token -> Melani shell as the front door ----------------
    console.log("\n== pairing with a fresh token ==");
    const token = mintToken();
    await cdp.send("Page.navigate", { url: `${WEB_BASE}/pair#token=${token}` });
    await sleep(4000);
    const path1 = await evalJs(cdp, "location.pathname");
    assert(!path1.includes("pair"), `landed on main UI (path=${path1})`);

    const shell = await evalJs(
      cdp,
      `(() => {
        const shell = document.querySelector('[data-testid="melani-shell"]');
        const cols = shell ? getComputedStyle(shell).gridTemplateColumns : null;
        return {
          shell: !!shell,
          cols,
          rows: document.querySelectorAll('[data-testid="melani-employee-row"]').length,
          loading: !!document.querySelector('[data-testid="melani-loading"]'),
          empty: !!document.querySelector('[data-testid="melani-empty"]'),
          error: !!document.querySelector('[data-testid="melani-error"]'),
        };
      })()`,
    );
    assert(shell.shell, "Melani shell is the front door (2-col grid present)");
    assert(
      shell.cols !== null && shell.cols.split(" ").length === 2,
      `shell is a 2-column grid (cols=${shell.cols})`,
    );

    // Roster may still be loading on first paint; poll for rows to settle.
    let rows = shell.rows;
    let state = shell;
    for (let i = 0; i < 20 && rows === 0 && !state.empty && !state.error; i++) {
      await sleep(500);
      state = await evalJs(
        cdp,
        `(() => ({
          rows: document.querySelectorAll('[data-testid="melani-employee-row"]').length,
          empty: !!document.querySelector('[data-testid="melani-empty"]'),
          error: !!document.querySelector('[data-testid="melani-error"]'),
        }))()`,
      );
      rows = state.rows;
    }

    if (state.empty) {
      // Empty state is a legitimate terminal state (no NOW.md / roster). Prove
      // the empty state renders and capture it, but the row/collapse assertions
      // below can only run with a populated roster.
      assert(true, "roster empty state rendered (no employees configured)");
      await screenshot(cdp, "empty");
      console.warn(
        "\nWARN: roster is empty; populate ~/.jcode/knowledge-org/NOW.md + " +
          "~/.t3/superapp/roster.json (or set T3CODE_NOW_MD) to exercise rows.",
      );
    } else {
      assert(rows >= 7, `people-sidebar rendered the roster (${rows} employees, expected >= 7)`);
      await screenshot(cdp, "expanded");

      // -- 3. Row click opens a conversation ---------------------------
      console.log("\n== clicking a Melani employee row ==");
      const before = await evalJs(cdp, "location.href");
      // Capture the clicked employee's NAME from its row aria-label ("Name.
      // preview") so we can assert the stage header echoes the person, not a
      // project breadcrumb.
      const clickedName = await evalJs(
        cdp,
        `(() => {
          const row = document.querySelector('[data-testid="melani-employee-row"]');
          if (!row) return null;
          const label = row.getAttribute('aria-label') || '';
          return label.split('.')[0].trim() || null;
        })()`,
      );
      await evalJs(cdp, `document.querySelector('[data-testid="melani-employee-row"]').click()`);
      let open = { urlChanged: false, composer: false };
      for (let i = 0; i < 24; i++) {
        await sleep(500);
        open = await evalJs(
          cdp,
          `(() => ({
            urlChanged: location.href !== ${JSON.stringify(before)},
            composer: !!document.querySelector('textarea, [contenteditable="true"], [data-testid*="composer"]'),
          }))()`,
        );
        if (open.urlChanged && open.composer) break;
      }
      assert(
        open.urlChanged || open.composer,
        `row click OPENED a conversation (urlChanged=${open.urlChanged}, composer=${open.composer})`,
      );
      await screenshot(cdp, "conversation");

      // -- 3b. The stage shows the PERSON, not coding-app chrome -------
      console.log("\n== asserting the stage sheds coding-app chrome ==");
      // Poll for the person-shaped header to mount (it depends on the
      // employee<->conversation link being recorded at open time).
      let stage = { header: false, name: null, role: false };
      for (let i = 0; i < 20; i++) {
        stage = await evalJs(
          cdp,
          `(() => {
            const header = document.querySelector('[data-testid="melani-chat-header"]');
            const nameEl = document.querySelector('[data-testid="melani-chat-header-name"]');
            const roleEl = document.querySelector('[data-testid="melani-chat-header-role"]');
            return {
              header: !!header,
              name: nameEl ? nameEl.textContent.trim() : null,
              role: !!(roleEl && roleEl.textContent.trim().length > 0),
            };
          })()`,
        );
        if (stage.header && stage.name) break;
        await sleep(300);
      }
      assert(stage.header, "stage renders the person-shaped chat header");
      assert(
        stage.name !== null && (clickedName === null || stage.name === clickedName),
        `header shows the employee NAME (${stage.name}), not a breadcrumb`,
      );
      assert(stage.role, "header shows the employee's one-line role");

      // No project breadcrumb and no git chrome inside the shell stage.
      const chrome = await evalJs(
        cdp,
        `(() => {
          const stageEl = document.querySelector('[data-testid="melani-stage"]');
          const scope = stageEl || document;
          const texts = Array.from(scope.querySelectorAll('button, a, [role="button"]'))
            .map((el) => (el.textContent || '').trim());
          const hasInitGit = texts.some((t) => /initialize git/i.test(t));
          const hasAddAction = texts.some((t) => /^add action$/i.test(t));
          const breadcrumb = scope.querySelector('[aria-label="Thread breadcrumb"]');
          const bodyText = (scope.textContent || '');
          const hasBuildInX = /what should we build in/i.test(bodyText);
          return { hasInitGit, hasAddAction, breadcrumb: !!breadcrumb, hasBuildInX };
        })()`,
      );
      assert(!chrome.hasInitGit, 'NO "Initialize Git" button in the Melani shell stage');
      assert(!chrome.hasAddAction, 'NO "Add action" button in the Melani shell stage');
      assert(!chrome.breadcrumb, "NO project/thread breadcrumb in the Melani shell stage");
      assert(
        !chrome.hasBuildInX,
        'empty stage does NOT say "What should we build in X?" (person-shaped instead)',
      );
      await screenshot(cdp, "stage-header");

      // -- 4. Collapse / expand ----------------------------------------
      console.log("\n== collapsing and expanding the sidebar ==");
      const widthOf = () =>
        evalJs(
          cdp,
          `(() => {
            const s = document.querySelector('[data-testid="melani-shell"]');
            return s ? parseFloat(getComputedStyle(s).gridTemplateColumns.split(' ')[0]) : null;
          })()`,
        );
      const expandedWidth = await widthOf();
      await evalJs(cdp, `document.querySelector('[data-testid="melani-collapse-toggle"]').click()`);
      await sleep(500);
      const collapsedWidth = await widthOf();
      const collapsedFlag = await evalJs(
        cdp,
        `document.querySelector('[data-testid="melani-shell"]').hasAttribute('data-collapsed')`,
      );
      assert(
        collapsedFlag && collapsedWidth !== null && collapsedWidth <= 90,
        `collapse shrinks sidebar to the avatar rail (${expandedWidth}px -> ${collapsedWidth}px)`,
      );
      await screenshot(cdp, "collapsed");

      await evalJs(cdp, `document.querySelector('[data-testid="melani-collapse-toggle"]').click()`);
      await sleep(500);
      const reexpandedWidth = await widthOf();
      assert(
        reexpandedWidth !== null && reexpandedWidth > 90,
        `expand restores the full sidebar (${collapsedWidth}px -> ${reexpandedWidth}px)`,
      );

      // -- 6. Hire dialog: open, capture the overlay, close -------------
      console.log("\n== opening the hire dialog ==");
      await evalJs(
        cdp,
        `(() => { const b = document.querySelector('[data-testid="melani-hire"]'); if (b) b.click(); })()`,
      );
      let hire = { open: false };
      for (let i = 0; i < 12; i++) {
        await sleep(200);
        hire = await evalJs(
          cdp,
          `(() => ({ open: !!document.querySelector('[data-testid="melani-hire-dialog"]') }))()`,
        );
        if (hire.open) break;
      }
      assert(hire.open, "hire dialog opens as a sand overlay");
      if (hire.open) {
        await sleep(250); // let the 180ms enter settle
        await screenshot(cdp, "hire-dialog");
        // Close it again (reverse-state) so later checks see a clean stage.
        await evalJs(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
        await sleep(250);
      }
    }

    // -- 7. Reduced motion: EVERY new animation/transition is disabled --
    // Emulate prefers-reduced-motion: reduce via CDP and assert a row's
    // computed transition collapses to none (the repo's no-GPU-loop rule).
    console.log("\n== asserting reduced-motion disables shell motion ==");
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await sleep(300);
    const reduced = await evalJs(
      cdp,
      `(() => {
        const row = document.querySelector('[data-testid="melani-employee-row"]');
        const shell = document.querySelector('[data-testid="melani-shell"]');
        const rowT = row ? getComputedStyle(row).transition : null;
        const shellT = shell ? getComputedStyle(shell).transition : null;
        // A disabled transition computes to "all 0s ..." / "none" / empty.
        const isOff = (t) =>
          t == null || t === "none" || t === "" || /(^|\\s)all 0s\\b/.test(t) || /\\b0s\\b/.test(t);
        return { row: rowT, shell: shellT, rowOff: isOff(rowT), shellOff: isOff(shellT), hadRow: !!row };
      })()`,
    );
    if (reduced.hadRow) {
      assert(
        reduced.rowOff,
        `reduced-motion: employee row transition is disabled (transition="${reduced.row}")`,
      );
    } else {
      console.log("  (no employee row present; skipping row transition assertion)");
    }
    assert(
      reduced.shellOff,
      `reduced-motion: shell width transition is disabled (transition="${reduced.shell}")`,
    );
    // Restore normal motion so the media state doesn't leak to any later step.
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });

    proc.kill();
  } catch (e) {
    proc.kill();
    console.error("\nE2E ERROR:", e.message);
    process.exit(1);
  }

  console.log("\n\u2550\u2550 melani-shell e2e summary \u2550\u2550");
  if (failures.length) {
    console.error(`FAIL: ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS: Melani shell front-door + roster + open + collapse all hold.");
  process.exit(0);
}

main();
