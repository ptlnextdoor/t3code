/**
 * TODAY panel (SUPERAPP-PLAN.md, Slice 1).
 *
 * A collapsible strip pinned above the thread content that answers one
 * question: "what needs me right now?" Sources, fetched from the local server
 * (`/api/today`, read-only bridge):
 *  - NOW.md critical-path lines (the human-curated command center)
 *  - Dayflow timeline cards for today (what actually happened on screen)
 *
 * ponytail: renders NOW.md by extracting its top-priority section as plain
 * lines instead of full markdown. Ceiling: no links/tables. Upgrade path:
 * swap in the app's markdown renderer if this earns its keep.
 */
import { useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

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

/** Pull the critical-path bullet lines out of NOW.md (first section only). */
export function extractCriticalLines(nowMarkdown: string): Array<string> {
  const lines = nowMarkdown.split("\n");
  const out: Array<string> = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inSection) break;
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    const match = /^\s*(?:\d+\.|[-*])\s+(.*)$/.exec(line);
    if (match?.[1]) {
      // Strip markdown bold/code markers for plain-text rendering.
      out.push(match[1].replace(/\*\*|`/g, ""));
    }
  }
  return out.slice(0, 6);
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function TodayPanel() {
  const [payload, setPayload] = useState<TodayPayload | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/today"));
        if (!response.ok) return;
        const data = (await response.json()) as TodayPayload;
        if (!cancelled) setPayload(data);
      } catch {
        // Local-only convenience panel: stay silent when the bridge is absent.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toggle = () => {
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

  // Nothing to show: neither NOW.md nor Dayflow available. Render nothing.
  if (!payload || (payload.nowMarkdown === null && !payload.dayflowAvailable)) {
    return null;
  }

  const critical = payload.nowMarkdown ? extractCriticalLines(payload.nowMarkdown) : [];
  const latestCard = payload.cards[0];

  return (
    <div
      className="fixed top-10 right-3 z-40 max-w-md rounded-lg border bg-background/95 text-sm shadow-md backdrop-blur"
      data-testid="today-panel"
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <span>Today</span>
        {collapsed && critical[0] ? (
          <span className="truncate font-normal opacity-70">{critical[0]}</span>
        ) : null}
      </button>
      {collapsed ? null : (
        <div className="space-y-1 px-3 pb-2">
          {critical.map((line) => (
            <div key={line} className="truncate">
              {line}
            </div>
          ))}
          {latestCard ? (
            <div className="truncate text-xs opacity-60">
              Last screen activity {latestCard.start}–{latestCard.end}: {latestCard.title}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
