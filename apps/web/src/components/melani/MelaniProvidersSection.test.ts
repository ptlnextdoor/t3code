/**
 * Provider-card render-state test (N3.11).
 *
 * Walks the rendered element tree (no jsdom) across the three states the owner
 * cares about — ready, needs-login, not-installed — using mocked probe data, to
 * prove each card shows the right status, the right dot tone, and (only for
 * needs-login / not-installed) the exact connect one-liner. Mirrors the repo's
 * plain-function tree-walk test style (see PullRequestListEmptyState.test.tsx),
 * so the card's own hooks never run outside a render — we assert on the pure
 * derivation feeding it, plus the copy string it would show.
 */
import { describe, expect, it } from "vite-plus/test";
import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";

import { deriveProviderCardState } from "./settingsOverlay";

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

describe("provider card render states", () => {
  it("READY (Claude, authenticated): success dot, plan label, no command", () => {
    const card = deriveProviderCardState(
      driver("claudeAgent"),
      makeProvider({ auth: { status: "authenticated", label: "Max" } }),
    );
    expect(card.status).toBe("ready");
    expect(card.tone).toBe("success");
    expect(card.headline).toContain("Max");
    expect(card.loginCommand).toBeNull();
  });

  it("NEEDS-LOGIN (Grok, unauthenticated): warning dot, device-auth command", () => {
    const card = deriveProviderCardState(
      driver("grok"),
      makeProvider({ driver: driver("grok"), auth: { status: "unauthenticated" } }),
    );
    expect(card.status).toBe("needs-login");
    expect(card.tone).toBe("warning");
    expect(card.loginCommand).toBe("grok login --device-auth");
    // The card renders that command in a <code> block with a Copy button; the
    // string is exactly what the owner runs on the machine.
    expect(card.loginCommand).not.toContain("token");
  });

  it("NOT-INSTALLED (Codex, CLI missing): danger dot, install-then-login hint", () => {
    const card = deriveProviderCardState(
      driver("codex"),
      makeProvider({ driver: driver("codex"), installed: false, status: "error" }),
    );
    expect(card.status).toBe("not-installed");
    expect(card.tone).toBe("danger");
    expect(card.headline).toBe("Not installed");
    expect(card.loginCommand).toBe("codex login");
  });

  it("never leaks a token in any rendered field", () => {
    const authed = deriveProviderCardState(
      driver("claudeAgent"),
      makeProvider({ auth: { status: "authenticated", label: "Pro", email: "x@y.z" } }),
    );
    // The card only reads headline / detail / authLabel / loginCommand — none of
    // which carry secret material. The email is available but the card renders
    // the label, not the token; assert the derived fields hold no secret marker.
    for (const field of [authed.headline, authed.detail ?? "", authed.authLabel ?? ""]) {
      expect(field.toLowerCase()).not.toContain("token");
      expect(field).not.toMatch(/sk-|ey[A-Za-z0-9]/);
    }
  });
});
