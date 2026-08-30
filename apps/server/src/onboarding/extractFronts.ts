// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Brain-dump extraction: transcript text -> structured fronts.
 *
 * This is the ONE LLM call in voice-note onboarding. Everything downstream (the
 * assembler in @t3tools/shared/onboarding) is pure and deterministic; this step
 * is where a rambling transcript becomes life-areas with concrete items and
 * their timing.
 *
 * Cheapest existing path, deliberately: we shell out to whatever coding-agent
 * CLI is already installed and logged in on this machine (`claude`, else
 * `jcode`), in one-shot print mode with a JSON output contract — the same way
 * scripts/ side tooling drives a model. We do NOT stand up a ProviderRegistry
 * instance or a provider framework for a single structured call; that machinery
 * exists for the chat surface, not for a one-shot.
 *
 * Transcription is out of scope for this node: the pipeline starts at TEXT. The
 * UI may hand us a pasted brain-dump or (stretch) a transcript produced from a
 * dropped audio file via a local `whisper` binary; either way what reaches here
 * is a string.
 *
 * The prompt and the response parser are separated from the subprocess call so
 * both are unit-testable without spending a token: `buildExtractionPrompt` and
 * `parseExtractionResponse` are pure.
 */
import * as NodeChildProcess from "node:child_process";

import type { OnboardingExtraction, OnboardingFront } from "@t3tools/shared/onboarding";

/** Guardrails: a transcript longer than this is paste-bombing, not a brain-dump. */
export const MAX_TRANSCRIPT_CHARS = 12_000;

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly stage: "empty" | "spawn" | "parse" | "cli-missing",
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * The instruction we give the model. Distilled from the bake-off's learnings so
 * the extraction avoids the two failure modes we actually observed:
 *
 *  - Dropping an item because it sounded abandoned ("I should just accept it's
 *    not happening") — the prompt insists every concrete item is captured, and
 *    an abandoned one is captured AS the decision.
 *  - Rating a closing window as low urgency because no explicit date was spoken
 *    (the Finance/reimbursement lesson) — a closing window is `blocking` even
 *    without a date.
 *
 * Fronts are named by life-area, not by task. Dates are resolved to an absolute
 * short form ("Mon Aug 31", "Sep 3") the NOW.md deadline parser understands, so
 * relative speech ("Friday", "the 14th") does not reach the downstream parser.
 */
export function buildExtractionPrompt(transcript: string, today: Date): string {
  const todayLabel = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString("en-US", { weekday: "long" });
  return [
    "You are onboarding a new user by turning their spoken brain-dump into a",
    "structured plan. Read the whole transcript, then output ONLY a JSON object.",
    "",
    `Today is ${weekday}, ${todayLabel}. Resolve every relative time ("Friday",`,
    '"the 14th", "next week", "end of month") to an absolute short date like',
    '"Mon Aug 31" or "Sep 3", computed from today.',
    "",
    "Output shape (exact keys, no prose, no markdown fence):",
    "{",
    '  "fronts": [',
    "    {",
    '      "front": "life-area name, e.g. Work / Family / Health / Money",',
    '      "role": "one line describing what this area needs from them",',
    '      "urgency": "high | medium | low (the most time-sensitive item)",',
    '      "items": [',
    '        { "text": "one concrete action", "due": "Mon Aug 31" (optional),',
    '          "blocking": true (optional) }',
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "Rules, each one matters:",
    "- Name fronts by LIFE-AREA, not by task. Group related items under one front.",
    "- Capture EVERY concrete item or commitment mentioned. Do not invent items.",
    "  If they say they are abandoning something, capture that as the decision",
    '  (e.g. "Accept the side project is not happening this month"). Zero dropped.',
    "- Set blocking:true when an item is due within ~48h OR has a CLOSING WINDOW",
    "  even without an explicit date (a reimbursement window, a passport that",
    "  takes weeks, an offer someone else may take). A closing window is urgent.",
    '- Put an absolute date in "due" whenever any timing is implied.',
    "- Order fronts most-urgent-first.",
    "",
    "Transcript:",
    '"""',
    transcript.trim(),
    '"""',
  ].join("\n");
}

/**
 * Pull the JSON object out of a model's reply and validate it into an
 * OnboardingExtraction. Tolerant of the usual noise: a ```json fence, leading
 * prose, a trailing summary line. Strict about the shape once found — a
 * malformed front is dropped rather than trusted, and a reply with no usable
 * fronts is an error the caller surfaces as "couldn't read that, try again".
 */
export function parseExtractionResponse(raw: string): OnboardingExtraction {
  const jsonText = extractJsonObject(raw);
  if (jsonText === null) {
    throw new ExtractionError("no JSON object found in model reply", "parse");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ExtractionError("model reply was not valid JSON", "parse");
  }
  const fronts = coerceFronts(parsed);
  if (fronts.length === 0) {
    throw new ExtractionError("model produced no usable fronts", "parse");
  }
  return { fronts };
}

/** Find the outermost {...} in a noisy string by brace-matching. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function coerceFronts(parsed: unknown): Array<OnboardingFront> {
  const root = parsed as { fronts?: unknown };
  const rawFronts = Array.isArray(root?.fronts) ? root.fronts : [];
  const out: Array<OnboardingFront> = [];
  for (const entry of rawFronts) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const front = typeof e.front === "string" ? e.front.trim() : "";
    if (front.length === 0) continue;
    const role =
      typeof e.role === "string" && e.role.trim().length > 0
        ? e.role.trim()
        : `Owns everything under ${front}.`;
    const urgency =
      e.urgency === "high" || e.urgency === "medium" || e.urgency === "low" ? e.urgency : "medium";
    const items = coerceItems(e.items);
    if (items.length === 0) continue;
    out.push({ front, role, urgency, items });
  }
  return out;
}

function coerceItems(raw: unknown): Array<OnboardingFront["items"][number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<OnboardingFront["items"][number]> = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text.length > 0) out.push({ text });
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (text.length === 0) continue;
    const item: { text: string; due?: string; blocking?: boolean } = { text };
    if (typeof e.due === "string" && e.due.trim().length > 0) item.due = e.due.trim();
    if (e.blocking === true) item.blocking = true;
    out.push(item);
  }
  return out;
}

/**
 * Which installed CLI to drive, and how. We prefer `claude` (Claude Code) and
 * fall back to `jcode`; both accept a one-shot `-p` prompt on stdin and print a
 * reply to stdout. Returns null when neither is on PATH, so the caller can tell
 * the user to paste rather than crash.
 *
 * ponytail: PATH probe via `which`. Ceiling: no version pinning or model
 * selection flags; the machine's default logged-in CLI and model are used.
 */
export function resolveExtractionCli(): { bin: string; args: Array<string> } | null {
  for (const bin of ["claude", "jcode"]) {
    const probe = NodeChildProcess.spawnSync("which", [bin], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim().length > 0) {
      // `-p` reads the prompt as the print-mode message; text output is enough,
      // parseExtractionResponse digs the JSON object out of whatever comes back.
      return { bin, args: ["-p"] };
    }
  }
  return null;
}

/**
 * Run the extraction end to end: prompt -> CLI -> parsed fronts. The transcript
 * is passed as the prompt argument; a 90s cap keeps a wedged CLI from hanging
 * the request. Throws ExtractionError with a stage so the route can map it to a
 * useful message and status.
 */
export async function extractFronts(
  transcript: string,
  now: Date = new Date(),
): Promise<OnboardingExtraction> {
  const text = transcript.trim();
  if (text.length === 0) {
    throw new ExtractionError("transcript was empty", "empty");
  }
  const bounded = text.length > MAX_TRANSCRIPT_CHARS ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text;
  const cli = resolveExtractionCli();
  if (cli === null) {
    throw new ExtractionError("no coding-agent CLI (claude/jcode) on PATH", "cli-missing");
  }
  const prompt = buildExtractionPrompt(bounded, now);
  const reply = await new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      cli.bin,
      [...cli.args, prompt],
      { maxBuffer: 4 * 1024 * 1024, timeout: 90_000 },
      (error, stdout) => {
        if (error && !stdout) {
          reject(new ExtractionError(`extraction CLI failed: ${error.message}`, "spawn"));
          return;
        }
        resolve(stdout);
      },
    );
    child.on("error", (error) =>
      reject(new ExtractionError(`could not spawn ${cli.bin}: ${error.message}`, "spawn")),
    );
  });
  return parseExtractionResponse(reply);
}
