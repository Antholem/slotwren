import { describe, expect, it } from "vitest";

import {
  nextDate,
  timeOffLabel,
  timeOffSchemaFor,
  toTimeOffInput,
  zonedInstant,
  zonedParts,
} from "@/lib/time-off";

const NY = "America/New_York"; // DST 2026: starts Sun 8 Mar 02:00, ends Sun 1 Nov 02:00
const MANILA = "Asia/Manila"; // no DST, UTC+8

const form = (overrides: Partial<Parameters<ReturnType<typeof timeOffSchemaFor>["parse"]>[0]>) => ({
  allDay: true,
  startDate: "2026-11-06",
  endDate: "2026-11-06",
  startTime: "09:00",
  endTime: "17:00",
  reason: "",
  ...overrides,
});

describe("zonedInstant / zonedParts", () => {
  it("converts business-local wall time to UTC and back", () => {
    expect(zonedInstant("2026-11-06", "09:00", MANILA).toISOString()).toBe(
      "2026-11-06T01:00:00.000Z",
    );
    expect(zonedParts(new Date("2026-11-06T01:00:00Z"), MANILA)).toEqual({
      date: "2026-11-06",
      time: "09:00",
    });
  });

  it("uses the offset in force on that date in New York", () => {
    expect(zonedInstant("2026-07-01", "09:00", NY).toISOString()).toBe("2026-07-01T13:00:00.000Z"); // EDT
    expect(zonedInstant("2026-12-01", "09:00", NY).toISOString()).toBe("2026-12-01T14:00:00.000Z"); // EST
  });
});

describe("nextDate", () => {
  it("is calendar arithmetic across month and year ends", () => {
    expect(nextDate("2026-11-30")).toBe("2026-12-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
    expect(nextDate("2028-02-28")).toBe("2028-02-29");
    expect(nextDate("2026-03-07", 2)).toBe("2026-03-09");
  });
});

describe("timeOffSchemaFor: all day", () => {
  it("runs from local midnight to the next local midnight", () => {
    const value = timeOffSchemaFor(MANILA).parse(form({ reason: " Training " }));
    expect(value).toEqual({
      allDay: true,
      startsAt: new Date("2026-11-05T16:00:00Z"),
      endsAt: new Date("2026-11-06T16:00:00Z"),
      reason: "Training",
    });
  });

  it("is 25 hours on the day New York falls back (1 Nov 2026)", () => {
    const value = timeOffSchemaFor(NY).parse(
      form({ startDate: "2026-11-01", endDate: "2026-11-01" }),
    );
    expect(value.startsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // 00:00 EDT
    expect(value.endsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // 00:00 EST
    expect(value.endsAt.getTime() - value.startsAt.getTime()).toBe(25 * 3_600_000);
  });

  it("is 23 hours on the day New York springs forward (8 Mar 2026)", () => {
    const value = timeOffSchemaFor(NY).parse(
      form({ startDate: "2026-03-08", endDate: "2026-03-08" }),
    );
    expect(value.startsAt.toISOString()).toBe("2026-03-08T05:00:00.000Z"); // 00:00 EST
    expect(value.endsAt.toISOString()).toBe("2026-03-09T04:00:00.000Z"); // 00:00 EDT
    expect(value.endsAt.getTime() - value.startsAt.getTime()).toBe(23 * 3_600_000);
  });

  it("spans several days inclusively, across the DST change", () => {
    const value = timeOffSchemaFor(NY).parse(
      form({ startDate: "2026-10-31", endDate: "2026-11-02" }),
    );
    expect(value.startsAt.toISOString()).toBe("2026-10-31T04:00:00.000Z");
    expect(value.endsAt.toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });

  it.each([
    [{ endDate: "2026-11-05" }, "endDate", "on or after"],
    [{ startDate: "2026-02-30" }, "startDate", "Pick a date"],
    [{ endDate: "not a date" }, "endDate", "Pick a date"],
    [{ endDate: "2028-01-01" }, "endDate", "under a year"],
    [{ reason: "x".repeat(81) }, "reason", "80 characters"],
  ])("rejects %j", (overrides, path, message) => {
    const result = timeOffSchemaFor(MANILA).safeParse(form(overrides));
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path[0] === path);
    expect(issue?.message).toContain(message);
  });
});

describe("timeOffSchemaFor: part of a day", () => {
  const partial = (overrides: Parameters<typeof form>[0]) =>
    form({ allDay: false, endDate: "", ...overrides });

  it("converts the times on that date", () => {
    const value = timeOffSchemaFor(MANILA).parse(partial({ startTime: "13:00", endTime: "17:30" }));
    expect(value.startsAt.toISOString()).toBe("2026-11-06T05:00:00.000Z");
    expect(value.endsAt.toISOString()).toBe("2026-11-06T09:30:00.000Z");
    expect(value.allDay).toBe(false);
  });

  it("measures real time across the fall-back hour in New York", () => {
    const value = timeOffSchemaFor(NY).parse(
      partial({ startDate: "2026-11-01", startTime: "00:00", endTime: "04:00" }),
    );
    // 00:00 EDT → 04:00 EST is five hours of real time.
    expect(value.endsAt.getTime() - value.startsAt.getTime()).toBe(5 * 3_600_000);
  });

  it("refuses a time skipped by spring forward (02:30 on 8 Mar in New York)", () => {
    const result = timeOffSchemaFor(NY).safeParse(
      partial({ startDate: "2026-03-08", startTime: "02:30", endTime: "05:00" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("clocks change");
  });

  it("refuses a time that happens twice when clocks fall back (01:30 on 1 Nov)", () => {
    const result = timeOffSchemaFor(NY).safeParse(
      partial({ startDate: "2026-11-01", startTime: "01:30", endTime: "05:00" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["startTime"]);
  });

  it.each([
    [{ startTime: "13:00", endTime: "13:00" }, "endTime", "End after"],
    [{ startTime: "15:00", endTime: "13:00" }, "endTime", "End after"],
    [{ startTime: "13:15", endTime: "14:00" }, "startTime", "from the list"],
  ])("rejects %j", (overrides, path, message) => {
    const result = timeOffSchemaFor(MANILA).safeParse(partial(overrides));
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.path[0] === path)?.message).toContain(message);
  });

  it("accepts quarter hours when the business books every 15 minutes", () => {
    const value = timeOffSchemaFor(MANILA, 15).safeParse(
      partial({ startTime: "13:15", endTime: "14:45" }),
    );
    expect(value.success).toBe(true);
  });
});

describe("round trip and labels", () => {
  it("turns stored instants back into the same form values", () => {
    for (const zone of [NY, MANILA]) {
      for (const values of [
        form({ startDate: "2026-11-01", endDate: "2026-11-03", reason: "Holiday" }),
        form({
          allDay: false,
          startDate: "2026-03-09",
          endDate: "",
          startTime: "13:00",
          endTime: "15:30",
        }),
      ]) {
        const stored = timeOffSchemaFor(zone).parse(values);
        const back = toTimeOffInput(stored, zone);
        expect(back.startDate).toBe(values.startDate);
        expect(back.allDay).toBe(values.allDay);
        if (values.allDay) expect(back.endDate).toBe(values.endDate);
        else expect([back.startTime, back.endTime]).toEqual([values.startTime, values.endTime]);
      }
    }
  });

  it("reads like the mockup", () => {
    const schema = timeOffSchemaFor(MANILA);
    expect(timeOffLabel(schema.parse(form({})), MANILA)).toBe("Fri 6 Nov · All day");
    expect(
      timeOffLabel(schema.parse(form({ startDate: "2026-12-24", endDate: "2026-12-26" })), MANILA),
    ).toBe("Thu 24 – Sat 26 Dec");
    expect(
      timeOffLabel(schema.parse(form({ startDate: "2026-11-30", endDate: "2026-12-02" })), MANILA),
    ).toBe("Mon 30 Nov – Wed 2 Dec");
    expect(
      timeOffLabel(
        schema.parse(form({ allDay: false, endDate: "", startTime: "13:00", endTime: "17:00" })),
        MANILA,
      ),
    ).toBe("Fri 6 Nov · 13:00 – 17:00");
  });

  it("labels in the business timezone, not the viewer's", () => {
    const value = timeOffSchemaFor(NY).parse(
      form({ startDate: "2026-11-01", endDate: "2026-11-01" }),
    );
    expect(timeOffLabel(value, NY)).toBe("Sun 1 Nov · All day");
  });
});
