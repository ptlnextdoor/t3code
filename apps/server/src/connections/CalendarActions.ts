// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off
/**
 * Calendar reads for the TODAY payload.
 *
 * Read-only and deliberately tiny. The TODAY payload has a house rule against
 * large payloads, so this returns only what a deadline needs: title, start, and
 * an all-day flag, for the next 7 days. No descriptions, no attendees, no
 * locations. The escalation parser treats an event under 48h out as a dated
 * item and routes it to the owning employee.
 */
import { getAccessToken, grantsCalendar } from "./GoogleConnector.ts";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
/** Next 7 days only: enough for deadlines, small on the wire. */
const WINDOW_DAYS = 7;
/** Hard cap so a busy week can never balloon the TODAY payload. */
const MAX_EVENTS = 20;

/** One upcoming event, trimmed to what a deadline row renders. */
export interface CalendarEvent {
  readonly title: string;
  /** RFC3339 start (dateTime for timed events, date for all-day). */
  readonly start: string;
  readonly allDay: boolean;
}

interface GoogleEvent {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  status?: string;
}

/**
 * Fetch the next 7 days of events, or an empty list when calendar is not
 * connected. Never throws: a status surface that can fail is worse than one
 * that shows nothing.
 */
export async function upcomingCalendarEvents(
  now: Date = new Date(),
): Promise<Array<CalendarEvent>> {
  const token = await getAccessToken();
  if (!token) return [];

  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(MAX_EVENTS),
  });

  try {
    const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // A 403 here usually means the grant lacks the calendar scope. That is a
    // "connect calendar" state, not an error to surface.
    if (!response.ok) return [];
    const payload = (await response.json()) as { items?: Array<GoogleEvent> };
    return (payload.items ?? [])
      .filter((event) => event.status !== "cancelled")
      .map((event) => {
        const allDay = typeof event.start?.date === "string";
        return {
          title: event.summary ?? "(untitled)",
          start: event.start?.dateTime ?? event.start?.date ?? "",
          allDay,
        };
      })
      .filter((event) => event.start.length > 0)
      .slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

/** Whether calendar reads should even be attempted, from a stored scope string. */
export function calendarConnected(scope: string | undefined): boolean {
  return grantsCalendar(scope);
}
