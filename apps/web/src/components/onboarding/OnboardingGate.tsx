/**
 * Router-aware gate for the Onboarding view.
 *
 * Two rules, both from the spec:
 *  - FIRST RUN (no roster.json on this instance): show onboarding automatically
 *    in the rail, above the team, so a stranger's empty instance greets them
 *    with the brain-dump instead of an empty team.
 *  - EXISTING INSTANCE (roster present): onboarding is NEVER auto-shown. It is
 *    reachable only via an explicit "Re-onboard" toggle, and its commit stages
 *    a roster.json.new for a diff-confirm rather than replacing the live team.
 *    This is what keeps Aayu's running instance untouchable by accident.
 *
 * Roster presence is read from the same /api/today payload the Team rail uses
 * (rosterJson non-null), so there is no second source of truth.
 */
import { useCallback, useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { OnboardingPanel } from "./OnboardingPanel";

interface TodayPayload {
  readonly rosterJson?: string | null;
}

type Presence = "loading" | "absent" | "present";

export function OnboardingGate() {
  const [presence, setPresence] = useState<Presence>("loading");
  const [reonboard, setReonboard] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/today"));
      if (!response.ok) return;
      const data = (await response.json()) as TodayPayload;
      setPresence(data.rosterJson ? "present" : "absent");
    } catch {
      // Local-only surface: leave as-is when the bridge is absent.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First run: greet with onboarding automatically.
  if (presence === "absent") {
    return <OnboardingPanel existingInstance={false} onDone={() => void refresh()} />;
  }

  // Existing instance: a quiet, explicit way back in. Never auto-shown.
  if (presence === "present") {
    if (reonboard) {
      return (
        <OnboardingPanel
          existingInstance
          onDone={() => {
            setReonboard(false);
            void refresh();
          }}
        />
      );
    }
    return (
      <button
        type="button"
        className="onboard__reopen"
        data-testid="reonboard-open"
        onClick={() => setReonboard(true)}
        title="Rebuild your team from a fresh brain-dump. Staged for review before it replaces anything."
      >
        Re-onboard
      </button>
    );
  }

  return null;
}
