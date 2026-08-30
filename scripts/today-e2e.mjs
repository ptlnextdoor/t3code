/**
 * E2E design check for the TODAY command center.
 *
 * Serves the real built web app plus a stubbed `/api/today` fed by the real
 * NOW.md and Dayflow payload shape, then screenshots it so design regressions
 * are caught visually rather than by reading CSS.
 *
 * Usage: node scripts/today-e2e.mjs [outPng]
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = join(repoRoot, "apps/web/dist-harness");
const out = process.argv[2] ?? "/tmp/shots/today-e2e.png";

if (!existsSync(dist)) {
  console.error(
    `No harness build at ${dist}.\n  Run: T3CODE_DESIGN_HARNESS=1 npx vp run --filter @t3tools/web build`,
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
  ".woff2": "font/woff2",
};

/** Build the same payload shape the real server route returns. */
async function todayPayload() {
  const nowPath = join(homedir(), ".jcode/knowledge-org/NOW.md");
  const nowMarkdown = existsSync(nowPath) ? readFileSync(nowPath, "utf8") : null;
  // NOW.md's mtime is the briefing age (gap G1 staleness). T3CODE_NOW_MTIME
  // overrides it so the staleness notice can be screenshotted on demand.
  let nowGeneratedAt = null;
  if (process.env.T3CODE_NOW_MTIME) {
    nowGeneratedAt = process.env.T3CODE_NOW_MTIME;
  } else if (existsSync(nowPath)) {
    nowGeneratedAt = statSync(nowPath).mtime.toISOString();
  }
  let cards = [];
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(
      join(homedir(), "Library/Application Support/Dayflow/chunks.sqlite"),
      { readOnly: true },
    );
    cards = db
      .prepare(
        `SELECT day, start, end, title, category, subcategory FROM timeline_cards
          WHERE is_deleted = 0 ORDER BY start_ts DESC LIMIT 1`,
      )
      .all();
    db.close();
  } catch {
    cards = [];
  }
  return {
    cards,
    dayflowAvailable: cards.length > 0,
    generatedAt: new Date().toISOString(),
    nowGeneratedAt,
    nowMarkdown,
  };
}

const payload = await todayPayload();

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/today") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }
  const rel = url.pathname === "/" ? "/today-harness.html" : url.pathname;
  const file = join(dist, rel);
  if (existsSync(file) && !file.endsWith("/")) {
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
    return;
  }
  // SPA fallback
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(readFileSync(join(dist, "today-harness.html")));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
console.log(`serving ${dist} on :${port}`);

const shot = spawnSync(
  process.execPath,
  [
    join(repoRoot, "scripts/ui-screenshot.mjs"),
    `http://127.0.0.1:${port}/`,
    out,
    "1440",
    "900",
    "3500",
  ],
  { stdio: "inherit" },
);

server.close();
process.exit(shot.status ?? 0);
