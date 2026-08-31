/**
 * Calendar escalation routing tests.
 *
 * Locks the 48-hour promotion rule and the owner routing: a calendar event is
 * only a dated escalation when it starts under 48h away, and it routes to the
 * employee whose keywords its title matches. The boundary at exactly 48h is the
 * subtle case worth pinning.
 */
import { assert, describe, it } from "@effect/vitest";

import { calendarEscalations } from "./calendarEscalations";

const NOW = new Date("2026-08-30T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();

describe("calendarEscalations", () => {
  it("promotes an event under 48h out and routes it to its owner", () => {
    // "IECBES" is a Paper keyword; a submission tomorrow is a dated escalation.
    const events = [{ title: "IECBES submission", start: hoursFromNow(20), allDay: false }];
    const result = calendarEscalations(events, NOW);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.ownerId, "paper");
    assert.strictEqual(result[0]!.hoursUntil, 20);
  });

  it("excludes an event exactly 48h out (boundary is exclusive)", () => {
    const events = [{ title: "IECBES submission", start: hoursFromNow(48), allDay: false }];
    assert.deepStrictEqual(calendarEscalations(events, NOW), []);
  });

  it("includes an event just under 48h out", () => {
    const events = [{ title: "IECBES submission", start: hoursFromNow(47.9), allDay: false }];
    assert.strictEqual(calendarEscalations(events, NOW).length, 1);
  });

  it("drops an event that has already started", () => {
    const events = [{ title: "IECBES submission", start: hoursFromNow(-1), allDay: false }];
    assert.deepStrictEqual(calendarEscalations(events, NOW), []);
  });

  it("drops an event beyond the 48h horizon", () => {
    const events = [{ title: "IECBES submission", start: hoursFromNow(72), allDay: false }];
    assert.deepStrictEqual(calendarEscalations(events, NOW), []);
  });

  it("keeps an imminent event with no owner, marking ownerId null", () => {
    // An unrouted item is a visible signal the roster is wrong, not a silent drop.
    const events = [{ title: "dentist appointment", start: hoursFromNow(10), allDay: false }];
    const result = calendarEscalations(events, NOW);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.ownerId, null);
  });

  it("ignores an unparseable start time", () => {
    const events = [{ title: "broken", start: "not-a-date", allDay: false }];
    assert.deepStrictEqual(calendarEscalations(events, NOW), []);
  });
});
