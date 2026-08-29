// @effect-diagnostics globalDate:off
/**
 * NOW.md parser for the TODAY panel. Splits the command-center markdown into
 * typed sections so the UI can render each with the right accent and icon,
 * instead of dumping a flat bullet list.
 *
 * Kept framework-free and pure so it is trivially unit-testable.
 */

export type TodaySectionKind = "critical" | "drafts" | "deadlines" | "decisions" | "other";

/** A single actionable line. `lead` renders bold, `detail` stays gray. */
export interface TodayItem {
  readonly text: string;
  readonly lead: string;
  readonly detail: string;
  /** Verb for the row control, e.g. "Send". Null when nothing is actionable. */
  readonly action: string | null;
}

export interface TodaySection {
  readonly kind: TodaySectionKind;
  readonly title: string;
  readonly items: ReadonlyArray<TodayItem>;
}

/** Map a NOW.md "## ..." heading to a semantic kind via its emoji / words. */
function classifyHeading(heading: string): TodaySectionKind {
  const h = heading.toLowerCase();
  if (heading.includes("🔴") || h.includes("critical")) return "critical";
  if (heading.includes("🟠") || h.includes("draft")) return "drafts";
  if (heading.includes("🟡") || h.includes("deadline")) return "deadlines";
  if (heading.includes("🔵") || h.includes("decision")) return "decisions";
  return "other";
}

/** Strip inline markdown (bold/code) and the emoji prefix from a heading. */
function cleanHeading(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .replace(/[🔴🟠🟡🔵🟢]/gu, "")
    .replace(/\*\*|`/g, "")
    .trim();
}

/**
 * Infer the action verb for a row from its wording. The panel shows exactly
 * one control per row, so this must pick the single most useful verb.
 */
function inferAction(raw: string, kind: TodaySectionKind): string | null {
  const t = raw.toLowerCase();
  if (kind === "decisions") return "Decide";
  if (/never sent|not sent|unsent|sitting unsent/.test(t)) return "Send";
  if (/he replied|she replied|replied to you|asked twice|asked for/.test(t)) return "Reply";
  if (/not drafted|needs? a draft|rewrite/.test(t)) return "Draft";
  if (kind === "drafts") return "Review";
  return null;
}

/**
 * Split a raw markdown item into a bold lead and a gray detail.
 * Prefers an explicit **bold** span, else splits on the first em dash or
 * sentence break, so every row reads as "subject — what about it".
 */
function splitItem(raw: string): { lead: string; detail: string } {
  const bold = /\*\*(.+?)\*\*/.exec(raw);
  if (bold?.[1]) {
    const lead = bold[1].replace(/[.:\s]+$/, "");
    const detail = raw
      .replace(bold[0], "")
      .replace(/\*\*/g, "")
      .replace(/^[\s—.:-]+/, "")
      .trim();
    return { detail, lead };
  }
  const plain = raw.replace(/\*\*/g, "").replace(/`/g, "").trim();
  const dash = plain.indexOf(" — ");
  if (dash > 0) {
    return { detail: plain.slice(dash + 3).trim(), lead: plain.slice(0, dash).trim() };
  }
  return { detail: "", lead: plain };
}

/** Strip inline markdown from a raw item. */
function cleanItem(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

/** Build a structured item from a raw markdown line. */
function makeItem(raw: string, kind: TodaySectionKind): TodayItem {
  const { lead, detail } = splitItem(raw);
  return { action: inferAction(raw, kind), detail, lead, text: cleanItem(raw) };
}

/**
 * Parse NOW.md into sections. Only list items (numbered, dashed, or table rows)
 * are captured; prose and table separators are dropped.
 *
 * A bullet owns its soft-wrapped continuation lines. Markdown wraps a long
 * bullet across several source lines, and a line-at-a-time reader would treat
 * each fragment as its own item: the item loses the words that identify it
 * (so it routes to no employee at all) and the panel shows a sentence
 * fragment. Continuation is joined back into the bullet it belongs to.
 */
export function parseNowSections(markdown: string): Array<TodaySection> {
  const lines = markdown.split("\n");
  const sections: Array<TodaySection> = [];
  let current: { kind: TodaySectionKind; title: string; items: Array<string> } | null = null;

  const flush = () => {
    if (current && current.items.length > 0) {
      const kind = current.kind;
      sections.push({
        items: current.items.map((raw) => makeItem(raw, kind)),
        kind,
        title: current.title,
      });
    }
  };

  // Whether the previous line was a bullet that a following indented, non-empty,
  // non-structural line should continue.
  let openBullet = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      current = { items: [], kind: classifyHeading(line), title: cleanHeading(line) };
      openBullet = false;
      continue;
    }
    if (!current) continue;

    const bullet = /^\s*(?:\d+\.|[-*])\s+(.*)$/.exec(line);
    if (bullet?.[1]) {
      current.items.push(bullet[1]);
      openBullet = true;
      continue;
    }
    // Table rows: "| label | where | blocked on |" — keep the first two cells.
    if (line.trimStart().startsWith("|") && !/^\s*\|[\s|:-]+\|?\s*$/.test(line)) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length >= 2 && cells[0]!.toLowerCase() !== "draft") {
        current.items.push(`**${cells[0]}** ${cells[1]}`);
      }
      openBullet = false;
      continue;
    }
    // A wrapped continuation of the bullet above: indented and still prose.
    if (openBullet && /^\s+\S/.test(line)) {
      const last = current.items.length - 1;
      current.items[last] = `${current.items[last]!} ${line.trim()}`;
      continue;
    }
    // A blank line, or unindented prose, ends the bullet.
    openBullet = false;
  }
  flush();
  return sections;
}

/**
 * Back-compat helper used by the collapsed summary: the critical-path items.
 */
export function extractCriticalLines(markdown: string): Array<string> {
  const critical = parseNowSections(markdown).find((s) => s.kind === "critical");
  return (critical?.items ?? []).slice(0, 6).map((item) => item.text);
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Best-effort relative-time label for a deadline item like
 * "Mon Aug 31 — IECBES submission". Returns null when no date is found.
 * ponytail: only recognizes "Mon DD" / "Mon DDth"; year is inferred as the
 * nearest future occurrence. Ceiling: no explicit-year or ISO parsing.
 */
export function deadlineLabel(item: string, now: Date): string | null {
  const match = /\b([A-Za-z]{3})[a-z]*\s+(\d{1,2})\b/.exec(item);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (month === undefined) return null;
  const day = Number(match[2]);
  let year = now.getFullYear();
  let target = new Date(year, month, day);
  // A recently-passed deadline still reads as "overdue". Only roll to next
  // year once it is far enough back to clearly be a future recurrence.
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((target.getTime() - now.getTime()) / msPerDay);
  if (diffDays < -21) {
    year += 1;
    target = new Date(year, month, day);
  }
  const days = Math.round((target.getTime() - now.getTime()) / msPerDay);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 14) return `${days}d`;
  return null;
}

/** True when a countdown label should read as red rather than amber. */
export function isUrgentDeadline(label: string): boolean {
  if (label === "overdue" || label === "today" || label === "tomorrow") return true;
  const days = /^(\d+)d$/.exec(label);
  return days !== null && Number(days[1]) <= 2;
}
