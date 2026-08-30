// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import { buildTodayPayload } from "./TodayRoute.ts";

describe("TodayRoute", () => {
  it("builds a payload without throwing even when sources are missing", () => {
    const payload = buildTodayPayload();
    assert.isString(payload.generatedAt);
    assert.isArray(payload.cards);
    // rosterJson is null on an instance with no override file (the default),
    // or the raw JSON string a stranger dropped on disk.
    assert.isTrue(payload.rosterJson === null || typeof payload.rosterJson === "string");
    // Cards are capped to keep the payload small (t3code perf rule).
    assert.isAtMost(payload.cards.length, 30);
    // nowMarkdown is either null (missing file) or a bounded string.
    if (payload.nowMarkdown !== null) {
      assert.isAtMost(payload.nowMarkdown.length, 64 * 1024);
      // A present file carries an ISO mtime; a missing one carries null.
      assert.isString(payload.nowGeneratedAt);
    } else {
      assert.isNull(payload.nowGeneratedAt);
    }
    // Cards, when present, only contain today's rows.
    const localDay = new Date().toLocaleDateString("en-CA");
    for (const card of payload.cards) {
      assert.strictEqual(card.day, localDay);
    }
  });
});
