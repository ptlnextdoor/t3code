/**
 * Setup wizard state machine — pure, so the whole first-run flow is testable
 * without React, a server, or a browser.
 *
 * The wizard is the ribbon over machinery that already exists (connections,
 * brain-dump onboarding, the provisioner). This module owns only the
 * navigation logic: which step is visible, which steps may be skipped, whether
 * this is a first run, and how to survive a mid-wizard refresh. Everything with
 * a side effect (writing profile.json, opening a Google sign-in, committing a
 * roster) lives in the components and server routes this drives.
 *
 * The step order is the owner's canonical onboarding sequence (PRODUCT.md),
 * collapsed to the five that have built machinery behind them:
 *
 *   welcome     -> name + what this is                (writes profile.json)
 *   connections -> Gmail + Calendar + GitHub cards    (reuse, do not fork)
 *   remote      -> optional: run agents on a server   (teaches one command)
 *   braindump   -> the n21 OnboardingPanel embedded   (writes roster.json)
 *   done        -> "your team is working" -> Team rail
 *
 * `remote` is the only skippable step: a laptop-only user never needs it, and
 * the spec marks it "(optional)". The others each write a file the app renders
 * from, so skipping them would leave the promise unfulfilled.
 */

/** The five steps, in canonical order. A string union so it is exhaustive. */
export type SetupStep = "welcome" | "connections" | "remote" | "braindump" | "done";

/** Canonical order. The single source of truth for next/back and the rail. */
export const SETUP_STEPS: ReadonlyArray<SetupStep> = [
  "welcome",
  "connections",
  "remote",
  "braindump",
  "done",
];

/** Steps the user may skip with a "later" affordance. Only remote qualifies. */
export const SKIPPABLE_STEPS: ReadonlySet<SetupStep> = new Set<SetupStep>(["remote"]);

/** Human labels for the progress rail. Kept here so the rail has no copy of its own. */
export const STEP_LABELS: Readonly<Record<SetupStep, string>> = {
  welcome: "Welcome",
  connections: "Connections",
  remote: "Remote",
  braindump: "Your team",
  done: "Done",
};

/** True when this step can be skipped ("later"). */
export function isSkippable(step: SetupStep): boolean {
  return SKIPPABLE_STEPS.has(step);
}

/** Zero-based index of a step in canonical order (-1 if unknown). */
export function stepIndex(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step);
}

/** The step after `step`, or the same step if already last. Never wraps. */
export function nextStep(step: SetupStep): SetupStep {
  const i = stepIndex(step);
  if (i < 0) return SETUP_STEPS[0]!;
  return SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)]!;
}

/** The step before `step`, or the same step if already first. Never wraps. */
export function prevStep(step: SetupStep): SetupStep {
  const i = stepIndex(step);
  if (i <= 0) return SETUP_STEPS[0]!;
  return SETUP_STEPS[i - 1]!;
}

/** Whether a Back control should be shown. False on the first step and on done. */
export function canGoBack(step: SetupStep): boolean {
  return step !== "welcome" && step !== "done";
}

/** True once the user has reached the terminal step. */
export function isComplete(step: SetupStep): boolean {
  return step === "done";
}

/**
 * First-run detection. The wizard auto-shows only when BOTH the profile and the
 * roster are absent, exactly as the spec requires: a half-set-up instance (say
 * the user wrote a profile but never built a team) is NOT a first run, because
 * auto-popping the wizard over a partially-live instance would be the same
 * accidental-clobber risk n21 guards against. Re-running is always explicit.
 */
export function isFirstRun(input: {
  readonly profilePresent: boolean;
  readonly rosterPresent: boolean;
}): boolean {
  return !input.profilePresent && !input.rosterPresent;
}

/** localStorage key for the in-progress step, so a refresh does not lose place. */
export const SETUP_STEP_STORAGE_KEY = "t3code.setup.step";

/**
 * Resolve which step to resume on after a refresh. A persisted step wins so the
 * user is not thrown back to Welcome mid-flow; anything unrecognized falls back
 * to the first step. `done` is deliberately allowed to persist so a refresh on
 * the final screen does not restart the whole wizard.
 */
export function resumeStep(stored: string | null | undefined): SetupStep {
  if (stored && (SETUP_STEPS as ReadonlyArray<string>).includes(stored)) {
    return stored as SetupStep;
  }
  return SETUP_STEPS[0]!;
}

/**
 * Progress for the rail: 1-based position and total, and the fraction complete.
 * `done` reads as fully complete (1). The fraction is computed against the last
 * index so the bar fills to 100% only on the terminal step.
 */
export function progress(step: SetupStep): {
  readonly index: number;
  readonly total: number;
  readonly fraction: number;
} {
  const i = Math.max(0, stepIndex(step));
  const last = SETUP_STEPS.length - 1;
  return {
    index: i + 1,
    total: SETUP_STEPS.length,
    fraction: last === 0 ? 1 : i / last,
  };
}
