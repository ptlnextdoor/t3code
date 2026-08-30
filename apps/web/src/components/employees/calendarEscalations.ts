/**
 * Calendar events as dated escalations.
 *
 * A calendar event is only a "needs you" item when it is close: an appointment
 * next week is context, one in the next two days is a deadline. So an event is
 * promoted to an escalation only when its start is UNDER 48 hours away, then
 * routed to the employee who owns it by the same keyword match the NOW.md items
 * use (ownerOf). The 48h line is exclusive: an event exactly 48h out is still
 * "upcoming", not yet "imminent".
 */
import { ownerOf, type Employee, type EmployeeId, ROSTER } from "./roster";

/** Shape of a calendar event from the TODAY payload. */
export interface CalendarEventInput {
  readonly title: string;
  readonly start: string;
  readonly allDay: boolean;
}

/** A calendar event that is imminent enough to demand attention. */
export interface CalendarEscalation {
  readonly title: string;
  readonly start: string;
  readonly allDay: boolean;
  /** Hours until start, for the countdown label. */
  readonly hoursUntil: number;
  /** Owning employee, or null when the title matches no one's keywords. */
  readonly ownerId: EmployeeId | null;
}

/** Under this horizon, an event is a dated escalation rather than context. */
const IMMINENT_HORIZON_MS = 48 * 60 * 60 * 1000;

/**
 * Select the events that are imminent (start under 48h away and not already
 * past) and route each to its owner. Past events and far-future ones are
 * dropped. The 48h boundary is exclusive: exactly 48h out does not qualify.
 */
export function calendarEscalations(
  events: ReadonlyArray<CalendarEventInput>,
  now: Date,
  roster: ReadonlyArray<Employee> = ROSTER,
): Array<CalendarEscalation> {
  const nowMs = now.getTime();
  const result: Array<CalendarEscalation> = [];
  for (const event of events) {
    const startMs = Date.parse(event.start);
    if (Number.isNaN(startMs)) continue;
    const untilMs = startMs - nowMs;
    // Already started, or not yet imminent (>= 48h): not an escalation.
    if (untilMs < 0 || untilMs >= IMMINENT_HORIZON_MS) continue;
    result.push({
      title: event.title,
      start: event.start,
      allDay: event.allDay,
      hoursUntil: Math.floor(untilMs / (60 * 60 * 1000)),
      ownerId: ownerOf(event.title, roster),
    });
  }
  return result;
}
