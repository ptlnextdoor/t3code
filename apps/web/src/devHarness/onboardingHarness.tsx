/**
 * Isolated design harness for the Onboarding view (N2.1).
 *
 * Mounts ONLY the OnboardingPanel with a stubbed `fetch`, so the sand design of
 * the review step can be screenshotted without a server, auth, or a live model.
 * The stub returns a realistic proposed team (the founder fixture) so the cards,
 * item counts, and actions all render populated.
 *
 * Not shipped: built only under T3CODE_ONBOARD_HARNESS=1, used by
 * scripts/onboarding-e2e.mjs.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
import "../sand.css";
import { OnboardingPanel } from "../components/onboarding/OnboardingPanel";
import { assembleOnboarding } from "@t3tools/shared/onboarding";

/**
 * Build the canned brain-dump response from the REAL assembler, so the review
 * step renders exactly what the server would return (keywords derived from item
 * text, counts routed by the real parser) rather than hand-written stub data
 * that could misroute. The founder fixture, mirrored from the acceptance test.
 */
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
          { text: "Prep for the quarterly investor review", due: "Sep 4" },
        ],
      },
      {
        front: "Product",
        role: "Keeps the pilot demo and the app working.",
        urgency: "high",
        items: [
          {
            text: "Fix the signup crash in the onboarding flow before the Acme demo",
            due: "Sep 2",
            blocking: true,
          },
        ],
      },
      {
        front: "Hiring",
        role: "Closes the key engineering hire before she is gone.",
        urgency: "high",
        items: [
          {
            text: "Send Priya the senior eng offer before she takes Stripe",
            due: "Sep 4",
            blocking: true,
          },
        ],
      },
      {
        front: "Ops",
        role: "Handles the money, the cloud bill, and the filings.",
        urgency: "high",
        items: [
          { text: "Move money into the account for payroll", due: "Aug 30", blocking: true },
          { text: "Investigate why the AWS bill doubled" },
          {
            text: "Renew the company domain before it expires and takes us offline",
            blocking: true,
          },
        ],
      },
    ],
  },
  new Date("2026-08-30T09:00:00Z"),
);

const STUB = {
  ok: true,
  existing: false,
  items: assembled.items,
  roster: assembled.roster,
  nowMd: assembled.nowMd,
};

// Stub fetch so the panel's brain-dump POST returns the canned team. The e2e
// script drives the "Organize my life" click; this makes that click resolve.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/api/onboard/brain-dump")) {
    return Promise.resolve(new Response(JSON.stringify(STUB), { status: 200 }));
  }
  if (url.includes("/api/onboard/commit")) {
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, staged: false, employees: 4 }), { status: 200 }),
    );
  }
  return realFetch(input, init);
}) as typeof fetch;

const root = document.getElementById("root");
if (root) {
  // ?step=review seeds the textarea and auto-clicks Organize so the review step
  // (the design-heavy screen) renders without a manual click, which lets the
  // proven scripts/ui-screenshot.mjs capture it by URL alone.
  const autoReview = new URLSearchParams(location.search).get("step") === "review";
  createRoot(root).render(
    <StrictMode>
      <div className="sand-rail" style={{ maxWidth: 420, padding: 16 }}>
        <OnboardingPanel />
      </div>
    </StrictMode>,
  );
  if (autoReview) {
    const drive = () => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="onboarding-textarea"]');
      const organize = document.querySelector<HTMLButtonElement>(
        '[data-testid="onboarding-organize"]',
      );
      if (!ta || !organize) {
        setTimeout(drive, 50);
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(
        ta,
        "Board deck due Thursday, need the burn number from Dylan. Fix the signup crash before the Acme demo. Send Priya the offer before Stripe. Payroll runs the 30th. Renew the domain before it lapses.",
      );
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      setTimeout(() => organize.click(), 60);
    };
    setTimeout(drive, 120);
  }
}
