/**
 * First-run gate for the Setup wizard.
 *
 * The rule (PRODUCT.md + spec): the wizard auto-shows ONLY on a genuine first
 * run — profile.json AND roster.json both absent. On any instance that is even
 * partially set up it is NEVER auto-shown; it is reachable again only through an
 * explicit trigger (the Settings "Run setup again" entry, which dispatches the
 * `t3code:open-setup` event this gate listens for). That keeps a running
 * instance untouchable by accident, the same guarantee n21's re-onboard has.
 *
 * First-run state comes from /api/setup/state, the single server-side source of
 * truth, so the gate and the server never disagree.
 */
import { useCallback, useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { OnboardingGate } from "../onboarding/OnboardingGate";
import { SetupWizard } from "./SetupWizard";

/** Custom event a Settings entry fires to re-open the wizard on demand. */
export const OPEN_SETUP_EVENT = "t3code:open-setup";

type Phase = "loading" | "first-run" | "ready";

export function SetupGate() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [manualOpen, setManualOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/setup/state"));
      if (!res.ok) {
        setPhase("ready");
        return;
      }
      const data = (await res.json()) as { firstRun?: boolean };
      setPhase(data.firstRun ? "first-run" : "ready");
    } catch {
      // No bridge (or offline): fall through to the normal rail rather than
      // trapping the user in a wizard we can't complete.
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Let a Settings entry (or command palette) re-open the wizard explicitly.
  useEffect(() => {
    const open = () => setManualOpen(true);
    window.addEventListener(OPEN_SETUP_EVENT, open);
    return () => window.removeEventListener(OPEN_SETUP_EVENT, open);
  }, []);

  if (phase === "loading") return null;

  if (phase === "first-run" || manualOpen) {
    return (
      <SetupWizard
        onExit={() => {
          setManualOpen(false);
          void refresh();
        }}
      />
    );
  }

  // Set-up instance: hand back to n21's quiet re-onboard affordance.
  return <OnboardingGate />;
}
