/**
 * TODAY command center (SUPERAPP-PLAN.md, Slice 1).
 *
 * One surface that answers "what needs me right now?" and lets it be acted on.
 * Reads the local bridge `/api/today`:
 *  - NOW.md parsed into typed sections (critical, drafts, decisions)
 *  - Dayflow's current timeline card as live screen context
 *
 * Visual language is the "sand" system (see DESIGN.md + sand.css), matched to
 * the reference in design-refs/today-panel.png. Rules held here:
 *  - exactly ONE accent control in the panel: the single most urgent action
 *  - one line per row; copy is truncated rather than wrapped
 *  - gray labels, right-aligned values, 13px base, 1px hairlines
 */
import { useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";
import {
  deadlineLabel,
  isUrgentDeadline,
  parseNowSections,
  type TodaySection,
} from "./todayPanel.logic";

interface TodayTimelineCard {
  readonly day: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly category: string;
  readonly subcategory: string | null;
}

interface TodayPayload {
  readonly generatedAt: string;
  readonly nowMarkdown: string | null;
  readonly cards: ReadonlyArray<TodayTimelineCard>;
  readonly dayflowAvailable: boolean;
}

const COLLAPSED_STORAGE_KEY = "t3.todayPanel.collapsed";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
/** Rows shown per section before collapsing into a "Show N more" affordance. */
const PREVIEW_ROWS = 4;

/*
 * Team (above this panel in the rail) already surfaces the critical path,
 * grouped by the employee who owns it. Repeating those rows here made the rail
 * state the same four items twice, so Today is now strictly the work queue:
 * things to approve and decisions to make. Deadlines are likewise omitted since
 * every row carries its own countdown pill.
 */
const SECTION_ORDER = ["drafts", "decisions"] as const;

const SECTION_LABEL: Record<string, { title: string; unit: string }> = {
  critical: { title: "Critical path", unit: "items" },
  deadlines: { title: "Deadlines", unit: "dated" },
  decisions: { title: "Decisions", unit: "open" },
  drafts: { title: "Waiting on your approval", unit: "drafts" },
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Urgency class for a countdown pill. */
function pillClass(label: string): string {
  return isUrgentDeadline(label) ? "today-pill-now" : "today-pill-soon";
}

function SectionBlock({
  section,
  now,
  accentAction,
  expanded,
  onToggle,
}: {
  section: TodaySection;
  now: Date;
  /** Text of the one row allowed to use the accent control. */
  accentAction: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = SECTION_LABEL[section.kind] ?? { title: section.title, unit: "items" };
  const visible = expanded ? section.items : section.items.slice(0, PREVIEW_ROWS);
  const hidden = section.items.length - visible.length;

  return (
    <div className="today-sect" data-kind={section.kind}>
      <div className="today-sect__head">
        <span className="sand-section-title">{meta.title}</span>
        <span className="today-sect__count">
          {section.items.length} {meta.unit}
        </span>
      </div>
      <div className="sand-group">
        {visible.map((item) => {
          const badge = deadlineLabel(item.text, now);
          const isAccent = accentAction !== null && item.text === accentAction;
          return (
            <div className="sand-row today-row" key={item.text}>
              <span className="today-row__text">
                <b>{item.lead}</b>
                {item.detail ? <span className="today-row__detail"> {item.detail}</span> : null}
              </span>
              {badge ? (
                <span className={`sand-pill ${pillClass(badge)}`}>{badge}</span>
              ) : item.action ? (
                <button type="button" className={`today-act${isAccent ? " today-act--go" : ""}`}>
                  {item.action}
                </button>
              ) : null}
            </div>
          );
        })}
        {hidden > 0 ? (
          <button type="button" className="sand-row today-row today-row--more" onClick={onToggle}>
            <span className="today-row__more">Show {hidden} more</span>
          </button>
        ) : null}
        {expanded && section.items.length > PREVIEW_ROWS ? (
          <button type="button" className="sand-row today-row today-row--more" onClick={onToggle}>
            <span className="today-row__more">Show less</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TodayPanel() {
  const [payload, setPayload] = useState<TodayPayload | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/today"));
        if (!response.ok) return;
        const data = (await response.json()) as TodayPayload;
        if (!cancelled) {
          setPayload(data);
          setNow(new Date());
        }
      } catch {
        // Local-only convenience surface: stay silent when the bridge is absent.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort.
      }
      return next;
    });
  };

  if (!payload || (payload.nowMarkdown === null && !payload.dayflowAvailable)) {
    return null;
  }

  const sections = payload.nowMarkdown ? parseNowSections(payload.nowMarkdown) : [];
  const ordered = SECTION_ORDER.map((kind) => sections.find((s) => s.kind === kind)).filter(
    (s): s is TodaySection => s !== undefined,
  );
  const queued = ordered.reduce((sum, section) => sum + section.items.length, 0);
  // Exactly one accent in the panel: the first queued row that can be acted on.
  const accentAction =
    ordered.flatMap((section) => section.items).find((item) => item.action !== null)?.text ?? null;
  const latestCard = payload.cards[0];
  const dateLabel = now.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  });

  return (
    <div
      className="today-panel sand-rise"
      data-testid="today-panel"
      {...(collapsed ? { "data-collapsed": "" } : {})}
    >
      <button
        type="button"
        className="today-panel__head"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
      >
        <span className="today-panel__title">Queue</span>
        {queued > 0 ? <span className="sand-pill emp-pill-calm">{queued} queued</span> : null}
        <span className="today-panel__date">{dateLabel}</span>
      </button>

      {collapsed ? null : (
        <>
          <div className="today-panel__body sand-stagger">
            {ordered.length > 0 ? (
              ordered.map((section) => (
                <SectionBlock
                  key={section.kind}
                  section={section}
                  now={now}
                  accentAction={accentAction}
                  expanded={expanded[section.kind] ?? false}
                  onToggle={() =>
                    setExpanded((prev) => ({ ...prev, [section.kind]: !prev[section.kind] }))
                  }
                />
              ))
            ) : (
              <p className="today-panel__empty">Nothing waiting on you.</p>
            )}
          </div>

          {latestCard ? (
            <div className="today-panel__foot">
              <span className="today-panel__foot-text">Now · {latestCard.title}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
