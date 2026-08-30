/**
 * The Team surface: five employees, each with the one thing they need from you.
 *
 * Design rules, each one arrived at by looking at a render (see
 * design-refs/team-panel.png):
 *  - ONE urgency signal per row. An earlier pass had a red card border AND an
 *    amber pill on the same row, which contradicted itself. State now lives
 *    only in the leading edge bar, with the pill carrying detail.
 *  - No avatars. A monogram next to the name carried zero information and
 *    forced a 3-column grid that misaligned against multi-line asks.
 *  - The ask never truncates. It is the payload; everything else can clip.
 *  - Calm employees stay listed. A team member who vanishes reads as a bug.
 */
import { useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { deadlineLabel, isUrgentDeadline, parseNowSections } from "../todayPanel.logic";
import { countNeedingYou, summarizeEmployees, type EmployeeSummary } from "./summarize";

interface TodayPayload {
  readonly nowMarkdown: string | null;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Map employee state to the colour of its leading edge bar. */
const STATE_COLOR: Record<string, string> = {
  calm: "transparent",
  dated: "var(--sand-yellow)",
  "needs-you": "var(--sand-red)",
};

function EmployeeRow({
  summary,
  onOpen,
}: {
  summary: EmployeeSummary;
  onOpen: (summary: EmployeeSummary) => void;
}) {
  const { employee, ask, badge, state, total } = summary;
  // Only show a countdown for genuinely blocking work. Dates scraped from the
  // prose of a queued draft ("sitting since Aug 19") are context, not alarms.
  const countdown = state === "needs-you" && ask ? deadlineLabel(ask.text, new Date()) : null;
  const pillText = countdown ?? badge;
  const pillUrgent = countdown !== null && isUrgentDeadline(countdown);

  return (
    <button
      type="button"
      className="emp"
      style={{ "--emp-state": STATE_COLOR[state] } as React.CSSProperties}
      title={`${employee.role}\n\nClick to talk to ${employee.name}.`}
      onClick={() => onOpen(summary)}
    >
      <span className="emp__name">
        {employee.name}
        {pillText ? (
          <span className={`sand-pill ${pillUrgent ? "today-pill-now" : "emp-pill-calm"}`}>
            {pillText}
          </span>
        ) : state === "calm" ? (
          <span className="emp__idle">clear</span>
        ) : null}
      </span>
      <span className="emp__ask">
        {ask ? (
          <>
            <b>{ask.lead}</b>
            {ask.detail ? ` ${ask.detail}` : ""}
          </>
        ) : (
          <span className="emp__ask-empty">{employee.role}</span>
        )}
      </span>
      <span className="emp__status">
        {total > 0 ? `${total} open` : "nothing owed"} ·{" "}
        {employee.topics.join(", ") || "cross-area"}
      </span>
    </button>
  );
}

/**
 * `onOpenEmployee` is injected rather than resolved here on purpose: opening a
 * thread needs router and draft-store context, and a status surface must stay
 * renderable without them. Wiring it internally crashed the whole panel
 * wherever that context was absent.
 */
export function TeamPanel({
  onOpenEmployee,
}: {
  /** Returns a reason string when it could not open, or null on success. */
  onOpenEmployee?: (summary: EmployeeSummary) => void | Promise<string | null>;
} = {}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/today"));
        if (!response.ok) return;
        const data = (await response.json()) as TodayPayload;
        if (!cancelled) setMarkdown(data.nowMarkdown);
      } catch {
        // Local-only surface: silent when the bridge is absent.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (markdown === null) return null;

  const summaries = summarizeEmployees(parseNowSections(markdown));
  const needing = countNeedingYou(summaries);

  return (
    <div className="team-panel sand-rise" data-testid="team-panel">
      <div className="team-panel__head">
        <span className="team-panel__title">Team</span>
        {needing > 0 ? <span className="sand-pill today-pill-now">{needing} need you</span> : null}
        <span className="team-panel__meta">{summaries.length} working</span>
      </div>
      {notice ? <div className="team-panel__notice">{notice}</div> : null}
      <div className="team-panel__body sand-stagger">
        {summaries.map((summary) => (
          <EmployeeRow
            key={summary.employee.id}
            summary={summary}
            onOpen={(next) => {
              const result = onOpenEmployee?.(next);
              if (result instanceof Promise) {
                void result.then((reason) => setNotice(reason ?? null));
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
