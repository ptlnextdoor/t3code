#!/usr/bin/env node
/**
 * Throwaway diagnostic drive: pair with a token, land on the main UI, click
 * the first employee row and the first Queue action, and report what actually
 * happens (console errors, notices rendered, whether a composer opened).
 *
 * Usage: node scripts/diag-drive.mjs <webBaseUrl> <token>
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PLAYWRIGHT_CACHE = join(homedir(), "Library/Caches/ms-playwright");
function findChrome() {
  const explicit = process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  if (existsSync(PLAYWRIGHT_CACHE)) {
    const dirs = readdirSync(PLAYWRIGHT_CACHE).filter((d) => d.startsWith("chromium")).sort().reverse();
    const subs = [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const d of dirs) for (const sub of subs) {
      const p = join(PLAYWRIGHT_CACHE, d, sub);
      if (existsSync(p)) return p;
    }
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chrome)) return chrome;
  throw new Error("No Chrome binary found. Set CHROME_PATH.");
}

const [, , base = "http://localhost:5733", token = ""] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9222 + Math.floor(Math.random() * 500);
const proc = spawn(findChrome(), [
  `--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu",
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const r = this.pending.get(msg.id);
        if (r) { this.pending.delete(msg.id); msg.error ? r.reject(new Error(msg.error.message)) : r.resolve(msg.result); }
      } else {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(fn) { this.handlers.push(fn); }
}

async function evalJs(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text + " " + (exceptionDetails.exception?.description ?? ""));
  return result.value;
}

async function main() {
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
  const consoleErrors = [];
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  cdp.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      consoleErrors.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push("[exception] " + (msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text));
    }
  });

  const pairUrl = token ? `${base}/pair#token=${token}` : `${base}/`;
  console.log("navigate:", pairUrl);
  await cdp.send("Page.navigate", { url: pairUrl });
  await sleep(3500);

  const afterPairUrl = await evalJs(cdp, "window.location.href");
  console.log("after pair url:", afterPairUrl);
  const bodyText = await evalJs(cdp, "document.body.innerText.slice(0,400)");
  console.log("body snippet:", JSON.stringify(bodyText));

  // If still on /pair, report the pairing surface state
  const onPair = await evalJs(cdp, "location.pathname.includes('pair')");
  console.log("still on /pair:", onPair);

  // Look for team panel + employee rows
  const teamInfo = await evalJs(cdp, `(() => {
    const panel = document.querySelector('[data-testid="team-panel"]');
    const rows = [...document.querySelectorAll('.emp')];
    const today = document.querySelector('[data-testid="today-panel"]');
    const acts = [...document.querySelectorAll('.today-act')];
    return { hasTeamPanel: !!panel, empRows: rows.length, hasTodayPanel: !!today, todayActs: acts.map(a=>({label:a.textContent, disabled:a.disabled})) };
  })()`);
  console.log("teamInfo:", JSON.stringify(teamInfo));

  // Click first employee row
  if (teamInfo.empRows > 0) {
    const beforeUrl = await evalJs(cdp, "location.href");
    await evalJs(cdp, `document.querySelector('.emp').click()`);
    await sleep(1500);
    const afterUrl = await evalJs(cdp, "location.href");
    const notice = await evalJs(cdp, `document.querySelector('.team-panel__notice')?.textContent ?? null`);
    const composer = await evalJs(cdp, `!!document.querySelector('textarea, [contenteditable="true"], [data-testid*="composer"]')`);
    console.log("EMPLOYEE CLICK => urlChanged:", beforeUrl !== afterUrl, "| notice:", JSON.stringify(notice), "| composerVisible:", composer, "| afterUrl:", afterUrl);
  } else {
    console.log("EMPLOYEE CLICK => no employee rows to click");
  }

  // Click first Queue non-Send action
  if (teamInfo.hasTodayPanel) {
    const before = await evalJs(cdp, "location.href");
    const clicked = await evalJs(cdp, `(() => {
      const acts = [...document.querySelectorAll('.today-act')].filter(a=>!a.disabled && a.textContent.trim()!=='Send');
      if (acts.length===0) return null;
      acts[0].click();
      return acts[0].textContent;
    })()`);
    await sleep(1500);
    const after = await evalJs(cdp, "location.href");
    const qnotice = await evalJs(cdp, `document.querySelector('.today-panel__notice, .today-notice')?.textContent ?? null`);
    console.log("QUEUE CLICK =>", "action:", JSON.stringify(clicked), "| urlChanged:", before !== after, "| notice:", JSON.stringify(qnotice), "| afterUrl:", after);
  } else {
    console.log("QUEUE CLICK => no today-panel");
  }

  console.log("CONSOLE ERRORS:", consoleErrors.length ? JSON.stringify(consoleErrors, null, 1) : "(none)");
  ws.close(); proc.kill(); process.exit(0);
}
main().catch((e) => { console.error("DRIVE FAIL:", e.message); proc.kill(); process.exit(1); });
