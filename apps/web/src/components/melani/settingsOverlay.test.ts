/**
 * Settings overlay pure-logic tests (N3.11): the open/section state machine
 * and the provider-card state derivation across every probe shape the server
 * can report — the two pieces we prove without a browser.
 */
import { describe, expect, it } from "vite-plus/test";
import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";

import {
  CLOSED_OVERLAY_STATE,
  DEFAULT_SECTION,
  deriveProviderCardState,
  loginCommandForDriver,
  resolveSectionId,
  settingsOverlayReducer,
} from "./settingsOverlay";

const driver = (slug: string) => slug as unknown as ProviderDriverKind;

function makeProvider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: "inst" as ServerProvider["instanceId"],
    driver: driver("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z" as ServerProvider["checkedAt"],
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  } as ServerProvider;
}

describe("settingsOverlayReducer", () => {
  it("opens on the default section from closed", () => {
    const next = settingsOverlayReducer(CLOSED_OVERLAY_STATE, { type: "open" });
    expect(next).toEqual({ open: true, section: DEFAULT_SECTION });
  });

  it("opens directly onto a requested section", () => {
    const next = settingsOverlayReducer(CLOSED_OVERLAY_STATE, {
      type: "open",
      section: "machines",
    });
    expect(next).toEqual({ open: true, section: "machines" });
  });

  it("falls back to default for an unknown requested section", () => {
    const next = settingsOverlayReducer(CLOSED_OVERLAY_STATE, { type: "open", section: "bogus" });
    expect(next.section).toBe(DEFAULT_SECTION);
  });

  it("switches sections while open without closing", () => {
    const open = settingsOverlayReducer(CLOSED_OVERLAY_STATE, { type: "open" });
    const next = settingsOverlayReducer(open, { type: "select", section: "team" });
    expect(next).toEqual({ open: true, section: "team" });
  });

  it("closes but keeps the last section value", () => {
    const open = settingsOverlayReducer(CLOSED_OVERLAY_STATE, { type: "open", section: "about" });
    const closed = settingsOverlayReducer(open, { type: "close" });
    expect(closed).toEqual({ open: false, section: "about" });
  });

  it("reopen after close honors the newly requested section", () => {
    const open = settingsOverlayReducer(CLOSED_OVERLAY_STATE, { type: "open", section: "about" });
    const closed = settingsOverlayReducer(open, { type: "close" });
    const reopened = settingsOverlayReducer(closed, { type: "open", section: "providers" });
    expect(reopened).toEqual({ open: true, section: "providers" });
  });

  it("resolveSectionId coerces junk to the default", () => {
    expect(resolveSectionId(undefined)).toBe(DEFAULT_SECTION);
    expect(resolveSectionId("team")).toBe("team");
    expect(resolveSectionId("nope")).toBe(DEFAULT_SECTION);
  });
});

describe("loginCommandForDriver", () => {
  it("maps the connect one-liner per driver, device-auth for Grok", () => {
    expect(loginCommandForDriver(driver("claudeAgent"))).toBe("claude login");
    expect(loginCommandForDriver(driver("grok"))).toBe("grok login --device-auth");
    expect(loginCommandForDriver(driver("codex"))).toBe("codex login");
    expect(loginCommandForDriver(driver("grok"))).toContain("--device-auth");
  });

  it("returns null for an unknown driver", () => {
    expect(loginCommandForDriver(driver("mystery"))).toBeNull();
  });
});

describe("deriveProviderCardState", () => {
  it("reports checking when the machine has no snapshot yet", () => {
    const card = deriveProviderCardState(driver("claudeAgent"), undefined);
    expect(card.status).toBe("checking");
    expect(card.loginCommand).toBeNull();
    expect(card.tone).toBe("muted");
  });

  it("reports ready with the auth label when authenticated", () => {
    const card = deriveProviderCardState(
      driver("claudeAgent"),
      makeProvider({ auth: { status: "authenticated", label: "Pro" } }),
    );
    expect(card.status).toBe("ready");
    expect(card.headline).toBe("Connected · Pro");
    expect(card.authLabel).toBe("Pro");
    expect(card.tone).toBe("success");
    expect(card.loginCommand).toBeNull();
  });

  it("reports needs-login with the exact connect command when unauthenticated", () => {
    const card = deriveProviderCardState(
      driver("grok"),
      makeProvider({ driver: driver("grok"), auth: { status: "unauthenticated" } }),
    );
    expect(card.status).toBe("needs-login");
    expect(card.headline).toBe("Not connected");
    expect(card.loginCommand).toBe("grok login --device-auth");
    expect(card.tone).toBe("warning");
  });

  it("reports not-installed when the CLI is missing", () => {
    const card = deriveProviderCardState(
      driver("codex"),
      makeProvider({ driver: driver("codex"), installed: false, status: "error" }),
    );
    expect(card.status).toBe("not-installed");
    expect(card.tone).toBe("danger");
    // Still surfaces the login command for the once-installed next step.
    expect(card.loginCommand).toBe("codex login");
  });

  it("reports disabled when the provider is turned off", () => {
    const card = deriveProviderCardState(
      driver("claudeAgent"),
      makeProvider({ enabled: false, status: "disabled" }),
    );
    expect(card.status).toBe("disabled");
    expect(card.tone).toBe("muted");
    expect(card.loginCommand).toBeNull();
  });

  it("treats unknown auth as a soft needs-login that still offers the command", () => {
    const card = deriveProviderCardState(
      driver("claudeAgent"),
      makeProvider({ auth: { status: "unknown" } }),
    );
    expect(card.status).toBe("needs-login");
    expect(card.headline).toBe("Installed");
    expect(card.loginCommand).toBe("claude login");
  });
});
