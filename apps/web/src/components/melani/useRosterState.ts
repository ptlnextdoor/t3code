/**
 * Load the TODAY payload (NOW.md + roster) and project it into employee
 * summaries for the Melani shell. UI-SPEC §6 N3.1 roster status states.
 *
 * TeamPanel does this fetch inline and collapses every non-ready state to
 * `null`. The shell needs to tell those states apart — loading vs empty vs
 * error — so this hook surfaces an explicit status the sidebar can branch on.
 */
import { useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { parseNowSections } from "../todayPanel.logic";
import { resolveRoster } from "../employees/roster";
import { countNeedingYou, summarizeEmployees, type EmployeeSummary } from "../employees/summarize";

interface TodayPayload {
  readonly nowMarkdown: string | null;
  readonly nowGeneratedAt: string | null;
  readonly rosterJson?: string | null;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type RosterPhase = "loading" | "ready" | "error";

export interface RosterState {
  readonly phase: RosterPhase;
  readonly summaries: ReadonlyArray<EmployeeSummary>;
  readonly needing: number;
  readonly generatedAt: string | null;
}

/**
 * Fetch + project the roster, retrying on a timer. Distinguishes:
 *   - loading: no response yet (first paint).
 *   - error:   the bridge was unreachable and we have nothing to show.
 *   - ready:   we have a payload; `summaries` may still be empty, which the
 *              caller renders as the "no employees yet" empty state.
 * A transient refresh failure after a good load keeps the last-good data
 * (stays `ready`) rather than flashing an error over a populated roster.
 */
export function useRosterState(): RosterState {
  const [state, setState] = useState<RosterState>({
    generatedAt: null,
    needing: 0,
    phase: "loading",
    summaries: [],
  });

  useEffect(() => {
    let cancelled = false;
    let loadedOnce = false;
    const load = async () => {
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/today"));
        if (!response.ok) throw new Error(`today payload ${response.status}`);
        const data = (await response.json()) as TodayPayload;
        if (cancelled) return;
        const summaries = summarizeEmployees(
          parseNowSections(data.nowMarkdown ?? ""),
          resolveRoster(data.rosterJson ?? null),
        );
        loadedOnce = true;
        setState({
          generatedAt: data.nowGeneratedAt,
          needing: countNeedingYou(summaries),
          phase: "ready",
          summaries,
        });
      } catch {
        if (cancelled || loadedOnce) return;
        setState((prev) => ({ ...prev, phase: "error" }));
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
