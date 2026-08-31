// @effect-diagnostics globalDate:off
/**
 * Incremental-auth scope tests.
 *
 * The single most important behavior in this node: connecting Calendar on an
 * account that already has Gmail must request the UNION of scopes, so Google's
 * include_granted_scopes grant never drops Gmail. These lock that union.
 */
import { assert, describe, it } from "@effect/vitest";

import { scopesFor } from "./GoogleLogin.ts";

const GMAIL = "https://www.googleapis.com/auth/gmail.send";
const CAL = "https://www.googleapis.com/auth/calendar.readonly";

describe("scopesFor", () => {
  it("requests calendar plus the existing Gmail scope when adding calendar", () => {
    // The incremental case: Gmail is already granted, user clicks Connect on the
    // calendar card. The request must carry BOTH so Gmail is not revoked.
    const scopes = scopesFor("calendar", `openid email ${GMAIL}`);
    assert.include(scopes, CAL);
    assert.include(scopes, GMAIL);
  });

  it("always includes identity scopes so the account email is captured", () => {
    const scopes = scopesFor("gmail", undefined);
    assert.include(scopes, "openid");
    assert.include(scopes, "email");
    assert.include(scopes, GMAIL);
  });

  it("does not duplicate a scope already present", () => {
    const scopes = scopesFor("calendar", `openid email ${CAL}`);
    assert.strictEqual(scopes.filter((s) => s === CAL).length, 1);
  });

  it("connecting gmail on a calendar-only grant keeps calendar", () => {
    // Symmetry check: additivity works whichever connection came first.
    const scopes = scopesFor("gmail", `openid email ${CAL}`);
    assert.include(scopes, GMAIL);
    assert.include(scopes, CAL);
  });
});
