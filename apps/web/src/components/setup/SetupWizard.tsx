/**
 * The first-run Setup wizard: the ribbon over machinery that already exists.
 *
 * This component owns no side-effect engine of its own. It renders one step at
 * a time, drives navigation through the pure setupWizard.logic state machine,
 * and reuses the built surfaces for the heavy lifting: the connection cards
 * (n23) and the brain-dump OnboardingPanel (n21) are embedded, never forked.
 *
 * State it does own:
 *  - the current step, persisted to localStorage so a mid-wizard refresh
 *    resumes in place instead of restarting (spec: "refresh must not lose
 *    progress"),
 *  - the name typed in Welcome, flushed to /api/setup/profile before advancing.
 *
 * Everything visual is sand tokens; the entrance is one rise-in per step.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { ConnectionCards } from "../connections/ConnectionCards";
import { OnboardingPanel } from "../onboarding/OnboardingPanel";
import {
  canGoBack,
  isSkippable,
  nextStep,
  prevStep,
  progress,
  resumeStep,
  SETUP_STEPS,
  STEP_LABELS,
  SETUP_STEP_STORAGE_KEY,
  type SetupStep,
} from "./setupWizard.logic";

/** The one paragraph a stranger reads on minute one (PRODUCT.md brief). */
const WELCOME_BLURB =
  "This is your own instance of a life-running app. Tell it what's on your plate and it hires a small team of agents that watch your email, calendar, and work, then escalate only the things that actually need you. Everything stays on your machine. Let's set it up.";

/** The single command step 3 teaches. The web UI never shells out to run it. */
const PROVISION_COMMAND = "node scripts/provision-remote.mjs create --name my-box";

interface SetupStateResponse {
  readonly remoteReady?: boolean;
  readonly name?: string | null;
}

export function SetupWizard({
  onExit,
}: {
  /** Called when the wizard finishes (done -> Team rail) or the user closes it. */
  onExit?: () => void;
} = {}) {
  const [step, setStep] = useState<SetupStep>(() => {
    if (typeof window === "undefined") return SETUP_STEPS[0]!;
    return resumeStep(window.localStorage.getItem(SETUP_STEP_STORAGE_KEY));
  });
  const [remoteReady, setRemoteReady] = useState(false);

  // Persist the step on every change so a refresh resumes here.
  useEffect(() => {
    try {
      window.localStorage.setItem(SETUP_STEP_STORAGE_KEY, step);
    } catch {
      // Private-mode storage can throw; losing resume is acceptable, crashing is not.
    }
  }, [step]);

  // One read of server-side facts (remote readiness, existing name).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/setup/state"));
        if (!res.ok) return;
        const data = (await res.json()) as SetupStateResponse;
        if (!cancelled) setRemoteReady(data.remoteReady === true);
      } catch {
        // Offline first-run is fine; remote just shows the set-up path.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const advance = useCallback(() => setStep((s) => nextStep(s)), []);
  const goBack = useCallback(() => setStep((s) => prevStep(s)), []);

  const finish = useCallback(() => {
    try {
      window.localStorage.removeItem(SETUP_STEP_STORAGE_KEY);
    } catch {
      /* best-effort */
    }
    onExit?.();
  }, [onExit]);

  const prog = progress(step);

  return (
    <div className="setup" data-testid="setup-wizard" data-step={step}>
      <ProgressRail step={step} />

      <div className="setup__stage">
        {step === "welcome" ? <WelcomeStep onNext={advance} /> : null}
        {step === "connections" ? <ConnectionsStep /> : null}
        {step === "remote" ? <RemoteStep remoteReady={remoteReady} /> : null}
        {step === "braindump" ? <BrainDumpStep onDone={advance} /> : null}
        {step === "done" ? <DoneStep onEnter={finish} /> : null}
      </div>

      {step !== "welcome" && step !== "braindump" && step !== "done" ? (
        <div className="setup__nav" data-testid="setup-nav">
          {canGoBack(step) ? (
            <button type="button" className="setup__back" onClick={goBack} data-testid="setup-back">
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="setup__nav-right">
            {isSkippable(step) ? (
              <button
                type="button"
                className="setup__later"
                onClick={advance}
                data-testid="setup-skip"
              >
                Later
              </button>
            ) : null}
            <button
              type="button"
              className="setup__next"
              onClick={advance}
              data-testid="setup-next"
            >
              {prog.index === prog.total - 1 ? "Continue" : "Next"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The progress rail: one dot per step, filled up to the current one. */
function ProgressRail({ step }: { step: SetupStep }) {
  const prog = progress(step);
  return (
    <div
      className="setup__rail"
      data-testid="setup-rail"
      aria-label={`Step ${prog.index} of ${prog.total}`}
    >
      {SETUP_STEPS.map((s, i) => {
        const state = i < prog.index - 1 ? "done" : i === prog.index - 1 ? "active" : "todo";
        return (
          <div key={s} className={`setup__rail-item setup__rail-item--${state}`}>
            <span className="setup__rail-dot" />
            <span className="setup__rail-label">{STEP_LABELS[s]}</span>
          </div>
        );
      })}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = useCallback(async () => {
    if (name.trim().length === 0) {
      setError("Tell me your name first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/setup/profile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string };
      if (!res.ok || data.ok !== true) {
        setError(data.detail ?? "Couldn't save that. Try again.");
        setSaving(false);
        return;
      }
      onNext();
    } catch {
      setError("Couldn't reach the server. Is it running?");
      setSaving(false);
    }
  }, [name, onNext]);

  return (
    <section className="setup-step sand-rise" data-testid="setup-step-welcome">
      <div className="setup-step__eyebrow">Welcome</div>
      <h1 className="setup-step__title">Let's get your life together.</h1>
      <p className="setup-step__blurb">{WELCOME_BLURB}</p>
      <label className="setup-step__label" htmlFor="setup-name">
        What should I call you?
      </label>
      <input
        id="setup-name"
        ref={inputRef}
        className="setup-step__input"
        data-testid="setup-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        placeholder="Your name"
        maxLength={120}
        disabled={saving}
      />
      {error ? <div className="setup-step__error">{error}</div> : null}
      <button
        type="button"
        className="setup-step__cta"
        data-testid="setup-welcome-next"
        onClick={() => void save()}
        disabled={saving || name.trim().length === 0}
      >
        {saving ? "Saving…" : "Get started"}
      </button>
    </section>
  );
}

function ConnectionsStep() {
  return (
    <section className="setup-step sand-rise" data-testid="setup-step-connections">
      <div className="setup-step__eyebrow">Connections</div>
      <h1 className="setup-step__title">Connect your accounts.</h1>
      <p className="setup-step__blurb">
        One button each. Your mail and calendar stay on your machine; the app only reads what it
        needs to escalate the right things. You can skip any of these and add them later.
      </p>
      {/* Reused verbatim from n23 — Gmail + Calendar, one Connect button each. */}
      <ConnectionCards />
      {/* GitHub, honestly not-yet-built. Shown so the sequence is complete, not faked. */}
      <div className="conn-card" data-testid="connection-cards-github">
        <div className="conn-card__rows">
          <div className="conn-card__row" data-testid="connection-card-github">
            <span
              className="conn-card__dot"
              style={{ "--conn-dot": "var(--sand-text-quaternary)" } as never}
            />
            <div className="conn-card__body">
              <div className="conn-card__label">GitHub</div>
              <div className="conn-card__detail">Pull requests and issues, coming soon.</div>
            </div>
            <span className="conn-card__soon">Coming soon</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function RemoteStep({ remoteReady }: { remoteReady: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PROVISION_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <section className="setup-step sand-rise" data-testid="setup-step-remote">
      <div className="setup-step__eyebrow">Remote · optional</div>
      <h1 className="setup-step__title">Run your agents on a server.</h1>
      <p className="setup-step__blurb">
        Move the work off this laptop so it stays fast and your team keeps running when you close
        the lid. Optional, you can do this any time.
      </p>
      {remoteReady ? (
        <div className="setup-remote__connected" data-testid="setup-remote-connected">
          <span className="conn-card__dot" style={{ "--conn-dot": "var(--sand-green)" } as never} />
          <span>A remote server is already connected.</span>
        </div>
      ) : (
        <div className="setup-remote__cmd" data-testid="setup-remote-command">
          <p className="setup-remote__lede">Run this one command in your terminal:</p>
          <div className="setup-remote__code-row">
            <code className="setup-remote__code">{PROVISION_COMMAND}</code>
            <button
              type="button"
              className="setup-remote__copy"
              onClick={() => void copy()}
              data-testid="setup-remote-copy"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="setup-remote__note">
            It creates and hardens a box, joins your private network, and deploys the server. When
            it finishes, this step will show Connected.
          </p>
        </div>
      )}
    </section>
  );
}

function BrainDumpStep({ onDone }: { onDone: () => void }) {
  return (
    <section className="setup-step sand-rise" data-testid="setup-step-braindump">
      <div className="setup-step__eyebrow">Your team</div>
      <h1 className="setup-step__title">Tell me everything on your plate.</h1>
      {/* Embedded verbatim from n21; its own Start button drives onDone. */}
      <OnboardingPanel onDone={onDone} />
    </section>
  );
}

function DoneStep({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="setup-step sand-rise" data-testid="setup-step-done">
      <div className="setup-step__eyebrow">Done</div>
      <h1 className="setup-step__title">Your team is working.</h1>
      <p className="setup-step__blurb">
        Your employees are watching their areas and will escalate what needs you. Head to the rail
        to see what's next.
      </p>
      <button
        type="button"
        className="setup-step__cta"
        data-testid="setup-done-enter"
        onClick={onEnter}
      >
        Go to my team
      </button>
    </section>
  );
}
