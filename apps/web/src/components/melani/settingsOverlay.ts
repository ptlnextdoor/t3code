/**
 * Settings overlay — pure state + copy, no React (N3.11).
 *
 * The Melani shell has one clear way into configuration: a gear in the sidebar
 * footer (and Cmd+,) opens a sand-styled overlay dialog that floats OVER the
 * shell — the people-list stays mounted behind it, per the Grok-reference
 * overlay pattern (UI-SPEC teardown, `settings/overlay/`). This module owns the
 * two pieces worth proving without a browser:
 *
 *   1. The overlay's open/section state machine (which section is showing, and
 *      whether it is open), so the reducer is testable in isolation.
 *   2. The provider-card state derivation: given a server provider snapshot,
 *      decide READY / NEEDS-LOGIN / NOT-INSTALLED / DISABLED / CHECKING, and —
 *      for needs-login — the exact one-liner the owner runs on that machine to
 *      connect the subscription (`claude login`, `grok login --device-auth`, …).
 *
 * The server exposes provider STATUS (via the existing per-environment probes)
 * and REFRESH, but has no RPC to *run* a login flow, so the connect path is the
 * copy-the-command path plus a live Refresh. See the card's `loginCommand`.
 */
import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";

/** The sections shown in the overlay's left column, in order. */
export const SETTINGS_SECTIONS = [
  { id: "providers", label: "Providers" },
  { id: "machines", label: "Machines" },
  { id: "team", label: "Team" },
  { id: "about", label: "About" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_SECTION: SettingsSectionId = "providers";

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return value != null && SETTINGS_SECTIONS.some((section) => section.id === value);
}

/** Coerce an arbitrary string to a known section, falling back to the default. */
export function resolveSectionId(candidate: string | null | undefined): SettingsSectionId {
  return isSettingsSectionId(candidate) ? candidate : DEFAULT_SECTION;
}

export interface SettingsOverlayState {
  readonly open: boolean;
  readonly section: SettingsSectionId;
}

export const CLOSED_OVERLAY_STATE: SettingsOverlayState = {
  open: false,
  section: DEFAULT_SECTION,
};

export type SettingsOverlayAction =
  | { readonly type: "open"; readonly section?: string | undefined }
  | { readonly type: "close" }
  | { readonly type: "select"; readonly section: string };

/**
 * The overlay reducer. `open` may carry a target section (from the command
 * palette / a deep link); `select` switches sections while open; `close`
 * resets to closed but REMEMBERS nothing — reopening always lands on the
 * requested section or the default, matching the reference overlay.
 */
export function settingsOverlayReducer(
  state: SettingsOverlayState,
  action: SettingsOverlayAction,
): SettingsOverlayState {
  switch (action.type) {
    case "open":
      return { open: true, section: resolveSectionId(action.section ?? state.section) };
    case "close":
      return { ...state, open: false };
    case "select":
      // Selecting a section on a closed overlay is a no-op guard: the host only
      // dispatches this from a rendered nav, but keep the reducer total.
      return { open: state.open, section: resolveSectionId(action.section) };
    default:
      return state;
  }
}

// --- Provider cards --------------------------------------------------------

/**
 * The exact command the owner runs, per driver, to connect that provider's
 * subscription on a machine. This is the connect instruction the owner asked
 * for ("supergrok has a CLI grok-build you connect the same way every app has
 * you connect claude cli / codex cli"). Kept beside the status logic so the
 * card and any copy affordance read from ONE source.
 *
 * These mirror the not-authenticated hints the server's own probes print
 * (`codex login`, `agent login`, `grok login`) — Grok additionally supports
 * device-auth, which is the flow that works headless on a remote box.
 */
export const PROVIDER_LOGIN_COMMANDS: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("claudeAgent")]: "claude login",
  [ProviderDriverKind.make("codex")]: "codex login",
  [ProviderDriverKind.make("grok")]: "grok login --device-auth",
  [ProviderDriverKind.make("cursor")]: "agent login",
  [ProviderDriverKind.make("opencode")]: "opencode auth login",
};

export function loginCommandForDriver(driver: ProviderDriverKind): string | null {
  return PROVIDER_LOGIN_COMMANDS[driver] ?? null;
}

export type ProviderCardStatus =
  | "ready"
  | "needs-login"
  | "not-installed"
  | "disabled"
  | "checking";

export interface ProviderCardState {
  readonly status: ProviderCardStatus;
  /** Short status headline, e.g. "Connected · Pro" or "Not connected". */
  readonly headline: string;
  /** Longer supporting line, or null when the headline says it all. */
  readonly detail: string | null;
  /** For needs-login: the one-liner to run on this machine, else null. */
  readonly loginCommand: string | null;
  /** Auth label (plan / email) when the server reported one, else null. */
  readonly authLabel: string | null;
  /** Dot tone for the status indicator. */
  readonly tone: "success" | "warning" | "danger" | "muted";
}

/**
 * Collapse a raw server provider snapshot into the small state the card
 * renders. `undefined` means the server has not reported this driver yet on
 * the machine (still probing) — distinct from installed-but-unauthenticated.
 *
 * Precedence, most to least severe:
 *   checking (no snapshot) → disabled → not-installed → needs-login → ready.
 */
export function deriveProviderCardState(
  driver: ProviderDriverKind,
  provider: ServerProvider | undefined,
): ProviderCardState {
  const loginCommand = loginCommandForDriver(driver);
  if (provider === undefined) {
    return {
      status: "checking",
      headline: "Checking…",
      detail: "Waiting for this machine to report status.",
      loginCommand: null,
      authLabel: null,
      tone: "muted",
    };
  }
  if (!provider.enabled) {
    return {
      status: "disabled",
      headline: "Disabled",
      detail: provider.message ?? "Turned off for new sessions on this machine.",
      loginCommand: null,
      authLabel: null,
      tone: "muted",
    };
  }
  if (!provider.installed) {
    return {
      status: "not-installed",
      headline: "Not installed",
      detail: provider.message ?? "The CLI was not found on this machine's PATH.",
      // Installing is out of scope for a copy-one-liner, but showing the login
      // command is still the natural next step once installed.
      loginCommand,
      authLabel: null,
      tone: "danger",
    };
  }
  const authLabel = provider.auth.label ?? provider.auth.type ?? null;
  if (provider.auth.status === "authenticated") {
    return {
      status: "ready",
      headline: authLabel ? `Connected · ${authLabel}` : "Connected",
      detail: null,
      loginCommand: null,
      authLabel,
      tone: "success",
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      status: "needs-login",
      headline: "Not connected",
      detail: loginCommand
        ? "Run this on the machine, then Refresh:"
        : (provider.message ?? "Sign in to this provider's CLI on the machine."),
      loginCommand,
      authLabel: null,
      tone: "warning",
    };
  }
  // auth status "unknown": installed and enabled, but the probe could not read
  // credentials. Offer the login path but do not cry wolf about it.
  return {
    status: "needs-login",
    headline: "Installed",
    detail: loginCommand
      ? "Couldn't verify sign-in. If sessions fail, run this and Refresh:"
      : (provider.message ?? "Installed, but sign-in could not be verified."),
    loginCommand,
    authLabel,
    tone: "warning",
  };
}
