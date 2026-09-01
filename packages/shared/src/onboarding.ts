// @effect-diagnostics globalDate:off
/**
 * Onboarding assembler: the deterministic half of voice-note onboarding.
 *
 * A stranger records one rambling brain-dump. An LLM (server-side, see
 * apps/server .../OnboardRoute) turns that transcript into `fronts` — the messy
 * speech grouped into life-areas with concrete items. THIS module is the pure,
 * testable part: it turns those fronts into the two artifacts the app already
 * knows how to render:
 *
 *   1. a roster.json (parsed by employees/roster.ts parseRoster)
 *   2. a first NOW.md (parsed by todayPanel.logic.ts parseNowSections)
 *
 * The contract that makes this safe: the NOW.md we emit MUST parse cleanly
 * through the escalation parser we already shipped, every item must route to
 * exactly one employee (0 unrouted), and nothing the person said may be
 * dropped. That is the whole product promise — "minute 5 they have employees
 * escalating real things" — reduced to a pure function with a fixture test.
 *
 * Why a pure function in shared, not logic baked into the route: the server
 * calls it to produce the files, and the acceptance test calls it to prove the
 * round-trip through the real parser. Same code path, no drift.
 */

/** One concrete thing the person said, plus what we inferred about its timing. */
export interface OnboardingItem {
  /** The item as a short actionable line, e.g. "Chase Marcus for the revenue slide". */
  readonly text: string;
  /**
   * True when this is closing NOW: a hard deadline inside ~48h, or a closing
   * window even without an explicit date (the Finance lesson from the bake-off:
   * a reimbursement window that "closes in 30 days" is high-pressure, not calm).
   * Blocking items go to the critical path so an employee escalates them.
   */
  readonly blocking?: boolean;
  /**
   * An absolute short date the NOW.md deadline parser understands, e.g.
   * "Mon Aug 31" or "Sep 3". Relative speech ("Friday", "the 14th") is resolved
   * to this by the extraction step so deadlineLabel() can count down. Optional:
   * many items have no date at all.
   */
  readonly due?: string;
}

/** One life-area, named by life not by task (bake-off lesson). */
export interface OnboardingFront {
  /** The life-area name, e.g. "Work", "Family", "Paper". */
  readonly front: string;
  /** One line, the employee's job description. */
  readonly role: string;
  /** The most time-sensitive item's pressure, used as the front's default. */
  readonly urgency: "high" | "medium" | "low";
  readonly items: ReadonlyArray<OnboardingItem>;
}

/** The extraction output: the transcript turned into structured fronts. */
export interface OnboardingExtraction {
  readonly fronts: ReadonlyArray<OnboardingFront>;
}

/** A roster entry, shaped exactly like employees/roster.ts Employee. */
export interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly topics: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  /** Optional environment binding; absent = This Mac. See employees/roster.ts. */
  readonly host?: string;
}

export interface AssembledOnboarding {
  /** roster.json content, ready to JSON.stringify and write. */
  readonly roster: ReadonlyArray<RosterEntry>;
  /** NOW.md content, ready to write. Parses through parseNowSections. */
  readonly nowMd: string;
  /** Total concrete items captured. Zero means the transcript said nothing. */
  readonly items: number;
}

/**
 * Words too common to identify an item. Kept small and hand-picked: over-
 * filtering strips the very nouns ("book", "call") that route an item, so this
 * only drops pure grammar and filler, never content.
 */
const STOPWORDS = new Set<string>([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "up",
  "out",
  "off",
  "over",
  "into",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "i",
  "me",
  "we",
  "he",
  "she",
  "they",
  "it",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "am",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "should",
  "could",
  "can",
  "need",
  "needs",
  "get",
  "got",
  "that",
  "this",
  "these",
  "those",
  "so",
  "just",
  "still",
  "before",
  "after",
  "about",
  "than",
  "then",
  "now",
  "not",
  "no",
  "yes",
  "okay",
  "um",
  "uh",
  "like",
  "really",
  "actually",
  "maybe",
  "thing",
  "things",
  "some",
  "any",
  "all",
]);

/** Slugify a front name into a stable, filesystem-safe employee id. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "area";
}

/**
 * Extract routing keywords for a front from its own items. Every item
 * contributes its content words, so each item is guaranteed to contain at least
 * one keyword of the front that owns it — which is what makes routing total (0
 * unrouted). The front name is always included as a fallback keyword.
 *
 * ownerOf() matches by substring and takes the first employee that hits, so a
 * word shared by two fronts routes to whichever front is listed first: still
 * routed, never dropped. We keep keywords lowercase to match ownerOf's
 * lowercased haystack.
 */
function keywordsForFront(front: OnboardingFront): ReadonlyArray<string> {
  const words = new Set<string>();
  // The front name (and each of its words) always routes its own items.
  for (const w of front.front.toLowerCase().split(/\s+/)) {
    if (w.length > 2) words.add(w);
  }
  for (const item of front.items) {
    const tokens = item.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    for (const w of tokens) words.add(w);
  }
  return [...words];
}

/** Escape the one character that would break a markdown bullet's bold span. */
function cleanLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\*+/g, "").trim();
}

/**
 * Build the roster: one employee per front, in the order the extraction
 * produced them (which the LLM is told to sort most-urgent-first). Keywords are
 * derived so the NOW.md items route back to their owner.
 */
export function buildRoster(extraction: OnboardingExtraction): ReadonlyArray<RosterEntry> {
  const usedIds = new Set<string>();
  return extraction.fronts.map((front) => {
    let id = slugify(front.front);
    // Disambiguate colliding slugs ("Work" twice) so parseRoster's uniqueness
    // check never rejects our own output.
    let n = 2;
    while (usedIds.has(id)) {
      id = `${slugify(front.front)}-${n}`;
      n += 1;
    }
    usedIds.add(id);
    return {
      id,
      name: front.front,
      role: front.role,
      topics: [id],
      keywords: keywordsForFront(front),
    };
  });
}

/**
 * Assign each item to exactly one NOW.md section, driven by the item's timing
 * rather than its front, so a single calm front can still surface one blocking
 * item and vice versa.
 *
 *  - blocking (hard <48h / closing window)  -> Critical path
 *  - has a date but not blocking            -> Deadlines calendar
 *  - everything else                        -> Decisions hanging
 *
 * The three-way split guarantees every item lands in a section, so "every item
 * present" holds by construction.
 */
type Bucket = "critical" | "deadlines" | "decisions";

function bucketFor(item: OnboardingItem, front: OnboardingFront): Bucket {
  if (item.blocking) return "critical";
  if (item.due) return "deadlines";
  // A high-urgency front with no per-item date still escalates its items: the
  // person flagged the whole area as hot, so its undated items are decisions
  // that need a human, not calm background.
  if (front.urgency === "high") return "critical";
  return "decisions";
}

/**
 * Render the first NOW.md. The headings carry the emoji the parser classifies
 * on (🔴/🟡/🔵), and critical items use the bold-numbered form the parser and
 * the Team panel both expect ("1. **...**"). Dates are appended so
 * deadlineLabel() can render a countdown.
 */
export function buildNowMd(extraction: OnboardingExtraction, now: Date = new Date()): string {
  const critical: Array<string> = [];
  const deadlines: Array<string> = [];
  const decisions: Array<string> = [];

  for (const front of extraction.fronts) {
    for (const item of front.items) {
      const text = cleanLine(item.text);
      if (text.length === 0) continue;
      const bucket = bucketFor(item, front);
      if (bucket === "critical") {
        // Bold-numbered form the parser and Team panel expect. The date rides
        // inside the bold span so deadlineLabel() finds it on the critical row.
        const due = item.due ? ` — ${item.due}` : "";
        critical.push(`**${text}.${due}**`);
      } else if (bucket === "deadlines") {
        deadlines.push(`${item.due} — ${text}`);
      } else {
        decisions.push(text);
      }
    }
  }

  const dateLabel = now.toISOString().slice(0, 10);
  const out: Array<string> = ["# NOW — what needs YOU", "", `Updated ${dateLabel}.`, ""];

  if (critical.length > 0) {
    out.push("## 🔴 Critical path (next 72h)", "");
    critical.forEach((line, i) => out.push(`${i + 1}. ${line}`));
    out.push("");
  }
  if (deadlines.length > 0) {
    out.push("## 🟡 Deadlines calendar", "");
    for (const line of deadlines) out.push(`- ${line}`);
    out.push("");
  }
  if (decisions.length > 0) {
    out.push("## 🔵 Decisions hanging", "");
    for (const line of decisions) out.push(`- ${line}`);
    out.push("");
  }
  return out.join("\n");
}

/** Total concrete items across all fronts, ignoring empties. */
function countItems(extraction: OnboardingExtraction): number {
  let n = 0;
  for (const front of extraction.fronts) {
    for (const item of front.items) {
      if (cleanLine(item.text).length > 0) n += 1;
    }
  }
  return n;
}

/**
 * The whole assembler in one call: fronts in, {roster, nowMd, items} out.
 * Deterministic given a fixed `now`, so the acceptance fixture can assert on it.
 */
export function assembleOnboarding(
  extraction: OnboardingExtraction,
  now: Date = new Date(),
): AssembledOnboarding {
  return {
    roster: buildRoster(extraction),
    nowMd: buildNowMd(extraction, now),
    items: countItems(extraction),
  };
}
