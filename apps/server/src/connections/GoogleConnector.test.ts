// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import { shouldRefresh } from "./GoogleConnector.ts";

const HOUR = 3600_000;
const NOW = 1_700_000_000_000;

describe("shouldRefresh", () => {
  it("refreshes proactively before expiry, not lazily after it", () => {
    // This is the whole fix. The old behaviour only renewed on demand, so a
    // gap with nobody using the app let the connection die silently.
    const nearlyExpired = NOW + 5 * 60 * 1000; // 5 minutes left
    assert.isTrue(shouldRefresh(nearlyExpired, NOW));
  });

  it("leaves a healthy credential alone", () => {
    const fresh = NOW + 50 * 60 * 1000; // 50 minutes left of a 60 minute life
    assert.isFalse(shouldRefresh(fresh, NOW));
  });

  it("refreshes once 80% of the lifetime has burned down", () => {
    // 20% of an hour is 12 minutes; just under that must trigger.
    assert.isTrue(shouldRefresh(NOW + 11 * 60 * 1000, NOW));
    assert.isFalse(shouldRefresh(NOW + 13 * 60 * 1000, NOW));
  });

  it("treats an already-expired credential as needing refresh", () => {
    assert.isTrue(shouldRefresh(NOW - HOUR, NOW));
  });

  it("treats a missing expiry as needing refresh", () => {
    // Unknown state is not assumed healthy.
    assert.isTrue(shouldRefresh(undefined, NOW));
  });

  it("would have caught the real 12-hour lapse", () => {
    // The observed failure: token expired 23:12, still stale at 09:43.
    const expiredAt = new Date("2026-08-28T23:12:32Z").getTime();
    const noticedAt = new Date("2026-08-29T09:43:00Z").getTime();
    assert.isTrue(shouldRefresh(expiredAt, noticedAt));
    // And an hour before expiry it would already have renewed.
    assert.isTrue(shouldRefresh(expiredAt, expiredAt - 10 * 60 * 1000));
  });
});
