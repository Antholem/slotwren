/*
 * "Add to calendar": an .ics file (RFC 5545; Apple Calendar, Outlook, and
 * anything else) and a Google Calendar link. Times are UTC instants, so every
 * calendar shows them in its owner's own timezone.
 */

export type CalendarEvent = {
  /** Stable across downloads, so re-adding updates instead of duplicating. */
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description: string;
  location: string | null;
  url: string | null;
  /**
   * Bumped when the event changes (a reschedule), so calendars that already
   * have it update it in place. Default 0.
   */
  sequence?: number;
};

/** 20261124T020000Z */
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
const escape = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const encoder = new TextEncoder();

/** Fold a content line at 75 octets (not characters), continuing with a space. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line holds 75 octets; continuations hold 74 after their space.
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The whole .ics file, CRLF line endings. `now` stamps it (DTSTAMP). */
export function buildIcs(event: CalendarEvent, now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Slotwren//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A Google Calendar "add event" link, prefilled. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(event.start)}/${stamp(event.end)}`,
    details: event.url ? `${event.description}\n\n${event.url}` : event.description,
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}
