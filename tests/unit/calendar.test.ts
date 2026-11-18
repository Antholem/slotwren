import { describe, expect, it } from "vitest";

import { buildIcs, type CalendarEvent, googleCalendarUrl } from "@/lib/calendar";

const event: CalendarEvent = {
  uid: "6f1c0d6e-0000-4000-8000-000000000001@slotwren.com",
  start: new Date("2026-11-24T06:30:00Z"),
  end: new Date("2026-11-24T07:15:00Z"),
  title: "Haircut & Style at Lumen Studio",
  description: "With Mia. Booking code SW-8K3D-27",
  location: "12 Lumen Lane, Makati",
  url: "https://slotwren.com/b/lumen-studio/booked/6f1c0d6e",
};
const NOW = new Date("2026-11-18T12:34:56.789Z");

describe("buildIcs", () => {
  const ics = buildIcs(event, NOW);
  const lines = ics.split("\r\n");

  it("writes one VEVENT in UTC with CRLF line endings", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `UID:${event.uid}`,
        "DTSTAMP:20261118T123456Z",
        "DTSTART:20261124T063000Z",
        "DTEND:20261124T071500Z",
        "SUMMARY:Haircut & Style at Lumen Studio",
        "DESCRIPTION:With Mia. Booking code SW-8K3D-27",
        "LOCATION:12 Lumen Lane\\, Makati",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ]),
    );
  });

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const tricky = buildIcs(
      { ...event, description: "Line one\nback\\slash; and, comma", location: null, url: null },
      NOW,
    );
    expect(tricky).toContain("DESCRIPTION:Line one\\nback\\\\slash\\; and\\, comma\r\n");
    expect(tricky).not.toContain("LOCATION:");
    expect(tricky).not.toContain("URL:");
  });

  it("folds long lines at 75 octets, counting multi-byte characters", () => {
    const long = buildIcs({ ...event, title: `Consultation ${"é".repeat(60)}` }, NOW);
    const physical = long.split("\r\n");
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    for (const line of physical) expect(bytes(line)).toBeLessThanOrEqual(75);
    const summary = long.slice(long.indexOf("SUMMARY:"), long.indexOf("\r\nDESCRIPTION"));
    // Unfolding (drop CRLF + space) restores the line, without splitting a character.
    expect(summary.replace(/\r\n /g, "")).toBe(`SUMMARY:Consultation ${"é".repeat(60)}`);
  });
});

describe("googleCalendarUrl", () => {
  it("prefills title, UTC dates, details and place", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "Haircut & Style at Lumen Studio",
      dates: "20261124T063000Z/20261124T071500Z",
      details: `With Mia. Booking code SW-8K3D-27\n\n${event.url}`,
      location: "12 Lumen Lane, Makati",
    });
  });

  it("leaves out an unknown place", () => {
    expect(
      new URL(googleCalendarUrl({ ...event, location: null })).searchParams.has("location"),
    ).toBe(false);
  });
});
