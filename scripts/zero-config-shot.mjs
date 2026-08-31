#!/usr/bin/env node
/**
 * Capture the thread that opens when you click an employee on a projectless
 * instance — the zero-config proof for N2.12. Pairs with a fresh token, clicks
 * the first employee, waits for the composer, and screenshots.
 *
 * Usage: node scripts/zero-config-shot.mjs <webBase> <out.png>
 * Env:   T3_BIN, T3CODE_HOME
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const WEB = process.argv[2] ?? "http://localhost:7349";
const OUT = process.argv[3] ?? "artifacts/zero-config-thread.png";
const T3_BIN = process.env.T3_BIN ?? "apps/server/dist/bin.mjs";
const CACHE = join(homedir(), "Library/Caches/ms-playwright");

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH;
  if (existsSync(CACHE)) {
    const dirs = readdirSync(CACHE)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse();
    for (const d of dirs)
      for (const sub of [
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      ]) {
        const p = join(CACHE, d, sub);
        if (existsSync(p)) return p;
      }
  }
  const c = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(c)) return c;
  throw new Error("No Chrome. Set CHROME_PATH.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = (() => {
  const out = execFileSync("node", [T3_BIN, "pair"], { encoding: "utf8" });
  return out.match(/^Token:\s*(\S+)/m)[1];
})();

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      const r = this.pending.get(m.id);
      if (r) {
        this.pending.delete(m.id);
        m.error ? r.reject(new Error(m.error.message)) : r.resolve(m.result);
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

async function main() {
  const port = 9222 + Math.floor(Math.random() * 500);
  const proc = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${port}`,
      "--headless=new",
      "--hide-scrollbars",
      "--no-sandbox",
      "--disable-gpu",
      "--force-color-profile=srgb",
      "--force-device-scale-factor=2",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    let target = null;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === "page");
        if (target?.webSocketDebuggerUrl) break;
      } catch {}
      await sleep(150);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("cdp failed")), { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: `${WEB}/pair#token=${token}` });
    await sleep(4000);
    // Click the first employee and wait for the composer to appear.
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.emp')?.click()`,
    });
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: `!!document.querySelector('textarea, [contenteditable="true"], [data-testid*="composer"]')`,
        returnByValue: true,
      });
      if (result.value) break;
    }
    await sleep(800);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(data, "base64"));
    console.log(`wrote ${OUT}`);
    ws.close();
    proc.kill();
    process.exit(0);
  } catch (e) {
    proc.kill();
    console.error(e.message);
    process.exit(1);
  }
}
main();
