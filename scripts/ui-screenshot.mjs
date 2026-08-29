#!/usr/bin/env node
/**
 * Dependency-free UI screenshot harness.
 *
 * Drives the cached Playwright headless Chromium over the DevTools protocol
 * using Node's built-in global WebSocket (Node 22+), so it adds no npm
 * dependency. Used to visually validate design work instead of guessing.
 *
 * Usage:
 *   node scripts/ui-screenshot.mjs <url> <out.png> [width] [height] [waitMs]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const PLAYWRIGHT_CACHE = join(homedir(), "Library/Caches/ms-playwright");

/** Find a usable Chrome binary: cached Playwright shell, else system Chrome. */
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
    for (const d of dirs) {
      for (const sub of subs) {
        const p = join(PLAYWRIGHT_CACHE, d, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chrome)) return chrome;
  throw new Error("No Chrome binary found. Set CHROME_PATH.");
}

const [, , url, out, w = "1440", h = "900", waitMs = "1200"] = process.argv;
if (!url || !out) {
  console.error("usage: ui-screenshot.mjs <url> <out.png> [w] [h] [waitMs]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    `--window-size=${w},${h}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

/** Minimal CDP client over the built-in WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const resolver = this.pending.get(msg.id);
      if (resolver) {
        this.pending.delete(msg.id);
        msg.error ? resolver.reject(new Error(msg.error.message)) : resolver.resolve(msg.result);
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
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      /* endpoint not up yet */
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
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: 2,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url });

  // Give the app time to boot, fetch, and finish its entrance animations.
  await sleep(Number(waitMs));

  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log(`wrote ${out}`);

  ws.close();
  proc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  proc.kill();
  process.exit(1);
});
