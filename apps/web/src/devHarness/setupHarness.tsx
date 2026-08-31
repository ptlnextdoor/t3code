/**
 * Isolated design harness for the Setup wizard (N2.8).
 *
 * Mounts the real SetupWizard with a stubbed `fetch`, so all five steps can be
 * screenshotted and driven headless without a server, auth, or a live model.
 * The stub answers the four endpoints the wizard and its embedded surfaces hit
 * (/api/setup/state, /api/setup/profile, /api/connections, /api/onboard/*) with
 * realistic shapes, and honors `?step=` to jump straight to any step so each
 * one can be captured in isolation.
 *
 * Not shipped: built only under T3CODE_SETUP_HARNESS=1, used by
 * scripts/setup-e2e.mjs.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
import "../sand.css";
import { SetupWizard } from "../components/setup/SetupWizard";
import { assembleOnboarding } from "@t3tools/shared/onboarding";
import {
  SETUP_STEP_STORAGE_KEY,
  SETUP_STEPS,
  type SetupStep,
} from "../components/setup/setupWizard.logic";

/** Realistic connection health so the cards render populated, not empty. */
const CONNECTIONS = {
  connections: [
    {
      id: "gmail",
      label: "Gmail",
      status: "not-set-up",
      account: null,
      detail: "Read and draft mail, with your approval.",
      canSend: false,
    },
    {
      id: "calendar",
      label: "Google Calendar",
      status: "not-set-up",
      account: null,
      detail: "See what's on your day.",
      canSend: false,
    },
  ],
};

/** The founder fixture, mirrored from the onboarding harness, for the review step. */
const assembled = assembleOnboarding(
  {
    fronts: [
      {
        front: "Fundraise",
        role: "Gets the round closed and investors current.",
        urgency: "high",
        items: [
          {
            text: "Send the investor update and chase Dylan for the burn number",
            due: "Aug 31",
            blocking: true,
          },
          { text: "Finish the data room for the seed lead" },
        ],
      },
      {
        front: "Product",
        role: "Keeps the pilot demo and the app working.",
        urgency: "high",
        items: [
          {
            text: "Fix the signup crash before the Acme demo",
            due: "Sep 2",
            blocking: true,
          },
        ],
      },
      {
        front: "Family",
        role: "Keeps home commitments from slipping.",
        urgency: "medium",
        items: [{ text: "Drive mom to her appointment on the 14th", due: "Sep 14" }],
      },
    ],
  },
  new Date("2026-08-30T09:00:00Z"),
);

// A remote-ready flag can be forced via ?remote=1 to screenshot the Connected state.
const params = new URLSearchParams(window.location.search);
const remoteReady = params.get("remote") === "1";

// Stub every network call the wizard makes, so the harness is fully offline.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (url.includes("/api/setup/state")) {
    return json({
      firstRun: true,
      profilePresent: false,
      rosterPresent: false,
      name: null,
      remoteReady,
    });
  }
  if (url.includes("/api/setup/profile")) {
    return json({ ok: true, name: "Aayu" });
  }
  if (url.includes("/api/connections/connect")) {
    return json({ ok: true, detail: "Connected." });
  }
  if (url.includes("/api/connections")) {
    return json(CONNECTIONS);
  }
  if (url.includes("/api/onboard/brain-dump")) {
    return json({
      ok: true,
      roster: assembled.roster,
      nowMd: assembled.nowMd,
      items: assembled.items,
      existing: false,
    });
  }
  if (url.includes("/api/onboard/commit")) {
    return json({ ok: true, employees: assembled.roster.length });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

// Jump straight to a requested step by seeding the resume key the wizard reads.
const requested = params.get("step");
if (requested && (SETUP_STEPS as ReadonlyArray<string>).includes(requested)) {
  try {
    window.localStorage.setItem(SETUP_STEP_STORAGE_KEY, requested as SetupStep);
  } catch {
    /* ignore */
  }
} else {
  try {
    window.localStorage.removeItem(SETUP_STEP_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ maxWidth: 640, margin: "24px auto", padding: "0 16px" }}>
      <SetupWizard />
    </div>
  </StrictMode>,
);
