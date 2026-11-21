import { describe, expect, it } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import {
  gridBounds,
  hoursToSpans,
  localSpan,
  merge,
  offSegments,
  placement,
  subtract,
  workingUntil,
} from "@/lib/timeline";
import { todayRanges } from "@/lib/today";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("localSpan", () => {
  const zone = "America/New_York";
  const day = todayRanges(zonedInstant("2026-11-04", "12:00", zone), zone);

  it("reads an appointment on the local clock", () => {
    const span = localSpan(
      {
        startsAt: zonedInstant("2026-11-04", "09:30", zone),
        endsAt: zonedInstant("2026-11-04", "10:15", zone),
      },
      day,
      zone,
    );
    expect(span).toEqual({ start: h(9, 30), end: h(10, 15) });
  });

  it("clips at both midnights, and an end at midnight is the end of the day", () => {
    expect(
      localSpan(
        {
          startsAt: zonedInstant("2026-11-03", "23:00", zone),
          endsAt: zonedInstant("2026-11-04", "01:00", zone),
        },
        day,
        zone,
      ),
    ).toEqual({ start: 0, end: h(1) });
    expect(
      localSpan(
        {
          startsAt: zonedInstant("2026-11-04", "23:00", zone),
          endsAt: zonedInstant("2026-11-05", "00:00", zone),
        },
        day,
        zone,
      ),
    ).toEqual({ start: h(23), end: h(24) });
  });
});

describe("gridBounds", () => {
  it("defaults to 09:00–18:00", () => {
    expect(gridBounds([])).toEqual({ start: h(9), end: h(18) });
  });

  it("widens to whole hours around everything", () => {
    expect(
      gridBounds([
        { start: h(9), end: h(17) },
        { start: h(8, 30), end: h(9, 15) },
        { start: h(17, 30), end: h(18, 15) },
      ]),
    ).toEqual({ start: h(8), end: h(19) });
  });

  it("stays within the day and at least an hour wide", () => {
    expect(gridBounds([{ start: h(23, 30), end: h(24) }])).toEqual({ start: h(23), end: h(24) });
    expect(gridBounds([{ start: h(10), end: h(10, 15) }])).toEqual({ start: h(10), end: h(11) });
  });
});

describe("working hours and time off", () => {
  const grid = { start: h(9), end: h(18) };

  it("merges and subtracts spans", () => {
    expect(
      merge([
        { start: h(12), end: h(14) },
        { start: h(9), end: h(12) },
      ]),
    ).toEqual([{ start: h(9), end: h(14) }]);
    expect(subtract([{ start: h(9), end: h(17) }], [{ start: h(12), end: h(13) }])).toEqual([
      { start: h(9), end: h(12) },
      { start: h(13), end: h(17) },
    ]);
  });

  it("reads hours, with 00:00 as an end meaning midnight", () => {
    expect(hoursToSpans([{ start: "18:00", end: "00:00" }])).toEqual([
      { start: h(18), end: h(24) },
    ]);
  });

  it("labels leaving early, and a day off", () => {
    expect(offSegments([{ start: h(9), end: h(13) }], grid)).toEqual([
      { start: h(13), end: h(18), label: "Off from 13:00" },
    ]);
    expect(offSegments([], grid)).toEqual([{ start: h(9), end: h(18), label: "Off today" }]);
    expect(offSegments([{ start: h(10), end: h(18) }], grid)).toEqual([
      { start: h(9), end: h(10), label: null },
    ]);
    expect(workingUntil([{ start: h(9), end: h(13) }], grid)).toBe("13:00");
    expect(workingUntil([{ start: h(9), end: h(18) }], grid)).toBeNull();
  });

  it("places spans as percentages of the grid, clipped to it", () => {
    expect(placement({ start: h(9), end: h(10) }, grid)).toEqual({ left: 0, width: 100 / 9 });
    expect(placement({ start: h(17), end: h(20) }, grid)).toEqual({
      left: (8 / 9) * 100,
      width: 100 / 9,
    });
  });
});
