// @effect-diagnostics globalDate:off
/**
 * Calendar connector state-machine tests.
 *
 * These lock the product-critical states rather than the transport: a grant
 * with Gmail but no calendar scope must read as "connect me", and connecting
 * calendar must be additive so Gmail survives. Mirrors the shape of
 * GoogleConnector.test.ts (pure functions, no network).
 */
import { assert, describe, it } from "@effect/vitest";

import { grantsCalendar } from "./GoogleConnector.ts";

const GMAIL = "openid email https://www.googleapis.com/auth/gmail.send";
const GMAIL_PLUS_CAL = `${GMAIL} https://www.googleapis.com/auth/calendar.readonly`;

describe("grantsCalendar", () => {
  it("is false for a Gmail-only grant (the incremental-auth trigger)", () => {
    // This is the whole reason the calendar card shows Connect even though the
    // account is already signed in for Gmail: the scope simply is not there yet.
    assert.isFalse(grantsCalendar(GMAIL));
  });

  it("is true once the calendar scope has been granted", () => {
    assert.isTrue(grantsCalendar(GMAIL_PLUS_CAL));
  });

  it("is false when no scope is recorded", () => {
    // Unknown is not assumed granted: a card that lies about access is worse
    // than one that asks again.
    assert.isFalse(grantsCalendar(undefined));
  });

  it("does not confuse a calendar scope with the send scope", () => {
    assert.isTrue(grantsCalendar("https://www.googleapis.com/auth/calendar.readonly"));
    assert.isFalse(grantsCalendar("https://www.googleapis.com/auth/gmail.send"));
  });
});
