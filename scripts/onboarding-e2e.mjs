/**
 * Screenshot harness for the Onboarding view (N2.1), the crux surface.
 *
 * Serves the built onboarding harness, then delegates the browser drive to the
 * repo's proven scripts/ui-screenshot.mjs. The harness auto-advances to the
 * review step when navigated with ?step=review, so the design-heavy screen (the
 * editable team cards) is what gets captured, with no bespoke CDP click logic.
 *
 * Build first:
 *   cd apps/web && T3CODE_ONBOARD_HARNESS=1 <pkgmgr> build
 *
 * Usage: node scripts/onboarding-e2e.mjs [outPng]
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = join(repoRoot, "apps/web/dist-harness");
const out = process.argv[2] ?? "/tmp/shots/onboarding-e2e.png";

if (!existsSync(join(dist, "onboarding-harness.html"))) {
  console.error(
    `No onboarding harness at ${dist}.\n  Run: cd apps/web && T3CODE_ONBOARD_HARNESS=1 ../../node_modules/.bin/vp build`,
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
  if (path === "/") path = "/onboarding-harness.html";
  const file = join(dist, path);
  if (!existsSync(file) || !file.startsWith(dist)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

const PORT = 4816;
server.listen(PORT, () => {
  const url = `http://127.0.0.1:${PORT}/onboarding-harness.html?step=review`;
  // Narrow, tall viewport: the onboarding panel is a rail card, not a page.
  const child = spawn(
    process.execPath,
    [join(repoRoot, "scripts/ui-screenshot.mjs"), url, out, "460", "1180", "1800"],
    { stdio: "inherit" },
  );
  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 0);
  });
});
