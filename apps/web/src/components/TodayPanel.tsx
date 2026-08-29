/**
 * TODAY panel (SUPERAPP-PLAN.md, Slice 1).
 *
 * A floating command-center card that answers one question: "what needs me
 * right now?" It reads the local server bridge (`/api/today`):
 *  - NOW.md, parsed into typed sections (critical path, drafts, deadlines,
 *    decisions), each with its own accent + icon
 *  - Dayflow's timeline card for the current block (what's on screen now)
 *
 * Styling matches the app's own surfaces (Card radius/border/shadow, semantic
 * destructive/warning/success/info tokens) rather than inventing a look.
 */
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleHelpIcon,
  MonitorIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";
import { cn } from "~/lib/utils";
import { ScrollArea } from "./ui/scroll-area";
import {
  deadlineLabel,
  parseNowSections,
  type TodaySection,
  type TodaySectionKind,
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

const SECTION_META: Record<
  TodaySectionKind,
  { icon: ComponentType<{ className?: string }>; accent: string; dot: string }
> = {
  critical: {
    accent: "text-destructive-foreground",
    dot: "bg-destructive",
    icon: AlertTriangleIcon,
  },
  drafts: { accent: "text-info-foreground", dot: "bg-info", icon: SendIcon },
  deadlines: { accent: "text-warning-foreground", dot: "bg-warning", icon: CalendarClockIcon },
  decisions: { accent: "text-foreground", dot: "bg-muted-foreground", icon: CircleHelpIcon },
  other: { accent: "text-muted-foreground", dot: "bg-muted-foreground", icon: CheckCircle2Icon },
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function SectionBlock({ section, now }: { section: TodaySection; now: Date }) {
  const meta = SECTION_META[section.kind];
  const Icon = meta.icon;
  // Deadlines and drafts stay compact; the critical path shows more.
  const limit = section.kind === "critical" ? 5 : 4;
  const items = section.items.slice(0, limit);
  const overflow = section.items.length - items.length;

  return (
    <div className="space-y-1.5">
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold", meta.accent)}>
        <Icon className="size-3.5" />
        <span>{section.title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item) => {
          const badge = section.kind === "deadlines" ? deadlineLabel(item, now) : null;
          const urgent = badge === "today" || badge === "tomorrow" || badge === "overdue";
          return (
            <li key={item} className="flex items-start gap-2 text-[13px] leading-snug">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", meta.dot)} />
              <span className="min-w-0 flex-1 text-foreground/90">{item}</span>
              {badge ? (
                <span
                  className={cn(
                    "shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-semibold tabular-nums",
                    urgent
                      ? "bg-destructive/12 text-destructive-foreground"
                      : "bg-warning/12 text-warning-foreground",
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </li>
          );
        })}
        {overflow > 0 ? (
          <li className="pl-3.5 text-[11px] text-muted-foreground">+{overflow} more</li>
        ) : null}
      </ul>
    </div>
  );
}

export function TodayPanel() {
  const [payload, setPayload] = useState<TodayPayload | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
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

  if (!payload || (payload.nowMarkdown === null && !payload.dayflowAvailable)) {
    return null;
  }

  const sections = payload.nowMarkdown ? parseNowSections(payload.nowMarkdown) : [];
  const ordered = (["critical", "drafts", "deadlines", "decisions", "other"] as const)
    .map((kind) => sections.find((s) => s.kind === kind))
    .filter((s): s is TodaySection => s !== undefined);
  const criticalCount = sections.find((s) => s.kind === "critical")?.items.length ?? 0;
  const latestCard = payload.cards[0];

  return (
    <div
      className={cn(
        "fixed right-4 top-11 z-40 w-[340px] overflow-hidden rounded-2xl border bg-card/95 text-card-foreground shadow-lg shadow-black/5 backdrop-blur-md",
        "not-dark:bg-clip-padding",
      )}
      data-testid="today-panel"
    >
      {/* Header */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="group flex w-full items-center gap-2 border-b bg-muted/30 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <SparklesIcon className="size-4 text-primary" />
        <span className="text-sm font-semibold tracking-tight">Today</span>
        {criticalCount > 0 ? (
          <span className="flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold tabular-nums text-white">
            {criticalCount}
          </span>
        ) : null}
        <span className="flex-1" />
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>

      {collapsed ? null : (
        <>
          <ScrollArea className="max-h-[min(60vh,520px)]" scrollFade>
            <div className="space-y-3.5 p-3.5">
              {ordered.length > 0 ? (
                ordered.map((section) => (
                  <SectionBlock key={section.kind} section={section} now={now} />
                ))
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  NOW.md is empty. Nothing waiting on you.
                </p>
              )}
            </div>
          </ScrollArea>

          {/* Footer: live screen context from Dayflow */}
          {latestCard ? (
            <div className="flex items-center gap-1.5 border-t bg-muted/20 px-3.5 py-2 text-[11px] text-muted-foreground">
              <MonitorIcon className="size-3 shrink-0" />
              <span className="truncate">
                {latestCard.start}–{latestCard.end}: {latestCard.title}
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
