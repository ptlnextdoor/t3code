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
import { parseRoster, resolveRoster } from "../employees/roster";
import { countNeedingYou, summarizeEmployees, type EmployeeSummary } from "../employees/summarize";

interface TodayPayload {
  readonly nowMarkdown: string | null;
  readonly nowGeneratedAt: string | null;
  readonly rosterJson?: string | null;
}

/**
 * Resolve the roster for the shell, distinguishing an INTENTIONALLY empty team
 * from a missing/broken config.
 *
 * The shared `resolveRoster` deliberately falls back to the built-in default on
 * an empty array, so the original instance always shows a team. But the shell
 * needs a genuine empty state (the setup-wizard pointer, UI-SPEC §6 N3.1), so a
 * stranger who writes a valid `[]` roster.json gets exactly that — an empty
 * roster — while a missing or malformed file still degrades to the default.
 */
function resolveShellRoster(rosterJson: string | null | undefined) {
  if (rosterJson) {
    try {
      // A valid parse (even to zero employees) is an explicit choice; honour it.
      return parseRoster(JSON.parse(rosterJson));
    } catch {
      // Malformed: fall through to the shared default-or-empty handling.
    }
  }
  return resolveRoster(rosterJson);
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * A hire (or any roster mutation) should show up immediately, not on the next
 * five-minute tick. The dialog dispatches this after a successful write and the
 * hook re-fetches the TODAY payload, so the new employee appears in the sidebar
 * at once. Named event rather than a shared query client because the roster
 * fetch here is a plain effect, not a tanstack query.
 */
export const ROSTER_REFRESH_EVENT = "t3code:roster-refresh";

export function refreshRoster(): void {
  window.dispatchEvent(new Event(ROSTER_REFRESH_EVENT));
}

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
          resolveShellRoster(data.rosterJson ?? null),
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
    // Re-fetch on demand after a hire, so a new employee lands immediately.
    const onRefresh = () => {
      void load();
    };
    window.addEventListener(ROSTER_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(ROSTER_REFRESH_EVENT, onRefresh);
    };
  }, []);

  return state;
}
