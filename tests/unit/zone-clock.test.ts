import { describe, expect, it } from "vitest";

import { nextDate, zonedInstant, zonedParts } from "@/lib/time-off";
import { zoneClock } from "@/lib/zone-clock";

// Zones with DST both ways, half-hour DST, odd offsets, and none at all.
const ZONES = [
  "America/New_York",
  "Europe/London",
  "Australia/Sydney",
  "Australia/Lord_Howe",
  "Asia/Kathmandu",
  "Asia/Manila",
  "America/Santiago",
  "UTC",
];

/** Every quarter hour of the days around 2026's changes in each hemisphere. */
const DATES = ["2026-03-08", "2026-03-29", "2026-04-05", "2026-10-04", "2026-10-25", "2026-11-01"];

describe("zoneClock", () => {
  it.each(ZONES)("reads instants like zonedParts in %s", (zone) => {
    const clock = zoneClock(zone);
    for (const date of DATES) {
      const start = Date.parse(`${nextDate(date, -1)}T00:00:00Z`);
      for (let t = start; t < start + 3 * 86_400_000; t += 15 * 60_000) {
        const { date: d, time } = clock.parts(t);
        expect({ date: d, time }).toEqual(zonedParts(new Date(t), zone));
      }
    }
  });

  // TZDate picks either reading of a repeated time depending on the zone (the
  // second in Sydney, the first in New York); zoneClock always picks the first.
  it.each(ZONES)(
    "resolves wall times like zonedInstant, repeated ones to the first, in %s",
    (zone) => {
      const clock = zoneClock(zone);
      const reads = (t: number, date: string, time: string) => {
        const p = zonedParts(new Date(t), zone);
        return p.date === date && p.time === time;
      };
      for (const date of DATES) {
        for (let m = 0; m < 24 * 60; m += 15) {
          const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const reference = zonedInstant(date, time, zone).getTime();
          // Every instant that reads as this wall time (at most two, a shift apart).
          const readings = [-60, -30, 0, 30, 60]
            .map((shift) => reference + shift * 60_000)
            .filter((t) => reads(t, date, time));
          // Skipped times (no reading) move forward by the gap, as TZDate does.
          const expected = readings.length > 0 ? Math.min(...readings) : reference;
          expect(clock.instant(date, time), `${date} ${time}`).toBe(expected);
        }
      }
    },
  );

  it("gives minutes past local midnight and the offset", () => {
    const ny = zoneClock("America/New_York");
    const t = Date.parse("2026-11-01T06:30:00Z"); // 01:30 EST, the second time
    expect(ny.parts(t)).toEqual({ date: "2026-11-01", time: "01:30", minutes: 90 });
    expect(ny.offsetMin(t)).toBe(-300);
    expect(ny.offsetMin(Date.parse("2026-11-01T05:30:00Z"))).toBe(-240);
  });

  it("returns the same clock for the same zone", () => {
    expect(zoneClock("Asia/Manila")).toBe(zoneClock("Asia/Manila"));
  });
});
