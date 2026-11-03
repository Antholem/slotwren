import { describe, expect, it } from "vitest";

import { gmtOffset, isValidTimeZone, listTimeZones, timeZoneLabel } from "@/lib/timezones";

describe("timezones", () => {
  it.each(["Asia/Manila", "Europe/London", "America/New_York", "UTC"])("knows %s", (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(["", "Mars/Olympus", "GMT+8 "])("rejects %j", (zone) => {
    expect(isValidTimeZone(zone)).toBe(false);
  });

  it("lists UTC and real zones", () => {
    const zones = listTimeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("Asia/Singapore");
  });

  it("labels zones with their offset at a given instant", () => {
    const july = new Date("2026-07-01T12:00:00Z");
    const january = new Date("2026-01-15T12:00:00Z");
    expect(timeZoneLabel("Asia/Singapore", july)).toBe("Asia/Singapore (GMT+8)");
    expect(timeZoneLabel("America/New_York", july)).toBe("America/New York (GMT-4)");
    expect(timeZoneLabel("America/New_York", january)).toBe("America/New York (GMT-5)");
    expect(gmtOffset("Asia/Kolkata", july)).toBe("GMT+5:30");
  });

  it("writes zero offset as plain GMT on every runtime", () => {
    expect(gmtOffset("UTC")).toBe("GMT");
    expect(gmtOffset("Europe/London", new Date("2026-01-15T12:00:00Z"))).toBe("GMT");
  });
});
