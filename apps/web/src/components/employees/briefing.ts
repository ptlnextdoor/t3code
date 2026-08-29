/**
 * Turning an employee into someone you can talk to.
 *
 * The gap this closes: until now the roster was a set of cards you looked at.
 * grokbot's whole appeal is that you *ask the worker* where things stand. So
 * clicking an employee opens a real conversation, primed with who that
 * employee is, what it owns, and what is currently on its plate.
 *
 * The briefing is deliberately written as an instruction to the agent rather
 * than as a summary for the human: the human already saw the card.
 */
import type { Employee } from "./roster";
import type { EmployeeSummary } from "./summarize";

/** Cap the briefing so a long backlog cannot blow out the context window. */
const MAX_LISTED_ITEMS = 8;

/**
 * Build the opening message that gives an employee its identity and its
 * current desk. Returned as plain text so it can be dropped straight into the
 * composer, where the human can edit it before sending.
 */
export function buildBriefing(summary: EmployeeSummary): string {
  const { employee, ask, criticalCount, draftCount, total } = summary;

  const lines: Array<string> = [
    `You are ${employee.name}, and this is your job: ${employee.role}`,
    "",
    `You own these areas: ${employee.topics.join(", ") || "cross-cutting work"}.`,
  ];

  if (total === 0) {
    lines.push(
      "",
      "Nothing is currently escalated to you. Give me a short status of your area",
      "and tell me the single most useful thing you could do next.",
    );
    return lines.join("\n");
  }

  lines.push("", `On your desk right now (${total} open):`);

  if (ask) {
    lines.push(`- Top priority: ${ask.text}`);
  }
  if (criticalCount > 1) {
    lines.push(`- ${criticalCount} items are on the critical path.`);
  }
  if (draftCount > 0) {
    lines.push(`- ${draftCount} drafts are waiting on my approval.`);
  }

  lines.push(
    "",
    "Start by telling me where things actually stand, in three sentences or fewer.",
    "Then tell me the one thing you need from me to move forward.",
    "Do not write me a report. If you can do something without me, say so and do it.",
  );

  return lines.join("\n");
}

/**
 * A short, human-facing label for the conversation, used as the thread title.
 * Keeps the roster legible in the sidebar next to 1,518 imported chats.
 */
export function conversationTitle(employee: Employee): string {
  return `${employee.name} · standup`;
}

/**
 * Search terms that find an employee's existing history among the imported
 * sessions, so its conversation can reference real prior work rather than
 * starting from nothing.
 */
export function historyQuery(employee: Employee): string {
  return [...employee.topics, ...employee.keywords.slice(0, 4)].join(" OR ");
}

/** Truncate a list of escalations for display inside a briefing. */
export function summarizeItems(items: ReadonlyArray<{ text: string }>): Array<string> {
  return items.slice(0, MAX_LISTED_ITEMS).map((item) => item.text);
}
