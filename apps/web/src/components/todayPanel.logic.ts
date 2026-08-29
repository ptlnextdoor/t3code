// @effect-diagnostics globalDate:off
/**
 * NOW.md parser for the TODAY panel. Splits the command-center markdown into
 * typed sections so the UI can render each with the right accent and icon,
 * instead of dumping a flat bullet list.
 *
 * Kept framework-free and pure so it is trivially unit-testable.
 */

export type TodaySectionKind = "critical" | "drafts" | "deadlines" | "decisions" | "other";

export interface TodaySection {
  readonly kind: TodaySectionKind;
  readonly title: string;
  readonly items: ReadonlyArray<string>;
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

/** Pull the first bold span or leading clause as a compact item label. */
function cleanItem(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

/**
 * Parse NOW.md into sections. Only list items (numbered, dashed, or table rows)
 * are captured; prose and table separators are dropped.
 */
export function parseNowSections(markdown: string): Array<TodaySection> {
  const lines = markdown.split("\n");
  const sections: Array<TodaySection> = [];
  let current: { kind: TodaySectionKind; title: string; items: Array<string> } | null = null;

  const flush = () => {
    if (current && current.items.length > 0) {
      sections.push({ kind: current.kind, title: current.title, items: current.items });
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      current = { items: [], kind: classifyHeading(line), title: cleanHeading(line) };
      continue;
    }
    if (!current) continue;

    const bullet = /^\s*(?:\d+\.|[-*])\s+(.*)$/.exec(line);
    if (bullet?.[1]) {
      current.items.push(cleanItem(bullet[1]));
      continue;
    }
    // Table rows: "| label | where | blocked on |" — keep the first two cells.
    if (line.trimStart().startsWith("|") && !/^\s*\|[\s|:-]+\|?\s*$/.test(line)) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length >= 2 && cells[0]!.toLowerCase() !== "draft") {
        current.items.push(cleanItem(`${cells[0]} — ${cells[1]}`));
      }
    }
  }
  flush();
  return sections;
}

/**
 * Back-compat helper used by the collapsed summary: the critical-path items.
 */
export function extractCriticalLines(markdown: string): Array<string> {
  const critical = parseNowSections(markdown).find((s) => s.kind === "critical");
  return (critical?.items ?? []).slice(0, 6);
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
