import { describe, expect, it } from "vitest";

import { minutesOf, timeOf } from "@/lib/hours";
import { nextDate, zonedInstant, zonedParts } from "@/lib/time-off";
import {
  getAvailableSlots,
  type BookingStatus,
  type Slot,
  type SlotBusiness,
  type SlotQuery,
  type SlotService,
  type SlotStaff,
} from "@/server/booking/slots";

/*
 * Specification for the slot engine. Dates are 2026:
 * - 12 Nov is a Thursday; the default business is in Manila (UTC+8, no DST).
 * - New York springs forward Sun 8 Mar (02:00 → 03:00 EDT) and falls back
 *   Sun 1 Nov (02:00 EDT → 01:00 EST).
 * - London is on GMT in November and BST (UTC+1) in July.
 */

const MANILA = "Asia/Manila";
const NY = "America/New_York";
const LONDON = "Europe/London";

const DAY = "2026-11-12"; // Thursday
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Local wall time in `zone` → instant. */
const at = (date: string, time: string, zone = MANILA) => zonedInstant(date, time, zone);

const NOW = at("2026-11-01", "08:00");

/** Every "HH:MM" from `first` to `last` inclusive. */
function grid(first: string, last: string, step = 30): string[] {
  const out: string[] = [];
  for (let m = minutesOf(first); m <= minutesOf(last); m += step) out.push(timeOf(m));
  return out;
}

const business = (overrides: Partial<SlotBusiness> = {}): SlotBusiness => ({
  timezone: MANILA,
  minNoticeMin: 0,
  maxDaysAhead: 60,
  slotIntervalMin: 30,
  ...overrides,
});

const service = (overrides: Partial<SlotService> = {}): SlotService => ({
  id: "cut",
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  ...overrides,
});

/** availability_rules rows: the same ranges on each of `weekdays`. */
const hours = (ranges: [string, string][], weekdays = EVERY_DAY) =>
  weekdays.flatMap((weekday) =>
    ranges.map(([startTime, endTime]) => ({ weekday, startTime, endTime })),
  );

const person = (overrides: Partial<SlotStaff> & { id: string }): SlotStaff => ({
  active: true,
  sortOrder: 0,
  serviceIds: ["cut"],
  hours: hours([["09:00", "17:00"]]),
  timeOff: [],
  bookings: [],
  ...overrides,
});

/** A booking's blocked range (buffers included), in local wall time. */
const booking = (
  date: string,
  start: string,
  end: string,
  { status = "confirmed", zone = MANILA }: { status?: BookingStatus; zone?: string } = {},
) => ({ bufferedStart: at(date, start, zone), bufferedEnd: at(date, end, zone), status });

/** Time off in local wall time. */
const away = (date: string, start: string, endDate: string, end: string, zone = MANILA) => ({
  startsAt: at(date, start, zone),
  endsAt: at(endDate, end, zone),
});

type Run = Partial<Omit<SlotQuery, "business">> & {
  business?: Partial<SlotBusiness>;
  /** Business-local day to query when `from`/`to` aren't given. */
  day?: string;
  /** Number of days from `day`. */
  days?: number;
};

/** Query one business-local day (or `days` of them) for Mia by default. */
function run({ business: b, day = DAY, days = 1, ...rest }: Run = {}): Slot[] {
  const biz = business(b);
  return getAvailableSlots({
    business: biz,
    service: service(),
    staff: [person({ id: "mia" })],
    staffId: "mia",
    from: at(day, "00:00", biz.timezone),
    to: at(nextDate(day, days), "00:00", biz.timezone),
    now: NOW,
    ...rest,
  });
}

/** Start times as local "HH:MM" in `zone`. */
const times = (slots: Slot[], zone = MANILA) => slots.map((s) => zonedParts(s.start, zone).time);

/** Start times grouped by local date in `zone`. */
function byDate(slots: Slot[], zone = MANILA): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const slot of slots) {
    const { date, time } = zonedParts(slot.start, zone);
    (out[date] ??= []).push(time);
  }
  return out;
}

const iso = (slots: Slot[]) => slots.map((s) => s.start.toISOString());
const MIN = 60_000;

describe("working hours", () => {
  it("offers every start on the grid that fits inside the day's hours", () => {
    const slots = run();
    expect(times(slots)).toEqual(grid("09:00", "16:30"));
    expect(slots.every((s) => s.staffId === "mia")).toBe(true);
    expect(slots[0]?.start).toEqual(new Date("2026-11-12T01:00:00Z"));
  });

  it("ends each slot after the service duration, without buffers", () => {
    const slots = run({ service: service({ durationMin: 45, bufferAfterMin: 15 }) });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.end.getTime() - slot.start.getTime()).toBe(45 * MIN);
  });

  it("uses each of several ranges in a day and never spans the gap between them", () => {
    const slots = run({
      service: service({ durationMin: 60 }),
      staff: [
        person({
          id: "mia",
          hours: hours([
            ["09:00", "12:00"],
            ["13:00", "17:00"],
          ]),
        }),
      ],
    });
    expect(times(slots)).toEqual([...grid("09:00", "11:00"), ...grid("13:00", "16:00")]);
  });

  it("drops starts where the service would run past the end of a range", () => {
    const slots = run({
      service: service({ durationMin: 90 }),
      staff: [person({ id: "mia", hours: hours([["09:00", "12:00"]]) })],
    });
    expect(times(slots)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("offers nothing on a day without hours", () => {
    const staff = [person({ id: "mia", hours: hours([["09:00", "17:00"]], WEEKDAYS) })];
    expect(run({ staff, day: "2026-11-14" })).toEqual([]); // Saturday
    expect(run({ staff, day: "2026-11-15" })).toEqual([]); // Sunday
    expect(run({ staff, day: "2026-11-13" })).not.toEqual([]); // Friday
  });

  it("offers nothing to someone with no hours at all", () => {
    expect(run({ staff: [person({ id: "mia", hours: [] })] })).toEqual([]);
  });

  it("reads Postgres time values with seconds", () => {
    const staff = [
      person({ id: "mia", hours: [{ weekday: 4, startTime: "09:00:00", endTime: "10:30:00" }] }),
    ];
    expect(times(run({ staff }))).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("returns starts in [from, to), including ones that end after `to`", () => {
    const slots = run({
      service: service({ durationMin: 60 }),
      from: at(DAY, "10:00"),
      to: at(DAY, "11:00"),
    });
    expect(times(slots)).toEqual(["10:00", "10:30"]);
  });

  it("returns slots sorted by start across several days", () => {
    const slots = run({ days: 3 });
    const starts = slots.map((s) => s.start.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(Object.keys(byDate(slots))).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });
});

describe("slot interval", () => {
  const staff = [person({ id: "mia", hours: hours([["09:00", "11:00"]]) })];
  const longer = service({ durationMin: 45 });

  it("steps by 30 minutes on a 30-minute grid", () => {
    expect(times(run({ staff, service: longer }))).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("steps by 15 minutes on a 15-minute grid", () => {
    const slots = run({ staff, service: longer, business: { slotIntervalMin: 15 } });
    expect(times(slots)).toEqual(grid("09:00", "10:15", 15));
  });

  it("starts at a quarter past when the hours do, on a 15-minute grid", () => {
    const slots = run({
      business: { slotIntervalMin: 15 },
      staff: [person({ id: "mia", hours: hours([["09:15", "10:00"]]) })],
    });
    expect(times(slots)).toEqual(["09:15", "09:30"]);
  });
});

describe("existing bookings", () => {
  it("blocks overlapping starts and allows back-to-back ones", () => {
    const staff = [person({ id: "mia", bookings: [booking(DAY, "10:00", "11:00")] })];
    const slots = times(run({ staff }));
    expect(slots).toContain("09:30");
    expect(slots).not.toContain("10:00");
    expect(slots).not.toContain("10:30");
    expect(slots).toContain("11:00");
  });

  it("blocks a longer service that would run into a booking", () => {
    const staff = [person({ id: "mia", bookings: [booking(DAY, "10:00", "11:00")] })];
    const slots = times(run({ staff, service: service({ durationMin: 60 }) }));
    expect(slots).toContain("09:00");
    expect(slots).not.toContain("09:30");
    expect(slots).toContain("11:00");
  });

  it("respects the existing booking's own buffers", () => {
    // A 10:00–11:00 appointment with 15 minutes either side blocks 09:45–11:15.
    const staff = [person({ id: "mia", bookings: [booking(DAY, "09:45", "11:15")] })];
    const slots = times(run({ staff }));
    expect(slots).toContain("09:00");
    for (const t of ["09:30", "10:00", "10:30", "11:00"]) expect(slots).not.toContain(t);
    expect(slots).toContain("11:30");
  });

  it("blocks only pending and confirmed bookings, like no_double_booking", () => {
    const withStatus = (status: BookingStatus) =>
      times(
        run({
          staff: [person({ id: "mia", bookings: [booking(DAY, "10:00", "11:00", { status })] })],
        }),
      );
    expect(withStatus("pending")).not.toContain("10:00");
    expect(withStatus("confirmed")).not.toContain("10:00");
    expect(withStatus("cancelled")).toContain("10:00");
    expect(withStatus("completed")).toContain("10:00");
    expect(withStatus("no_show")).toContain("10:00");
  });

  it("ignores bookings on other days", () => {
    const staff = [person({ id: "mia", bookings: [booking("2026-11-11", "10:00", "11:00")] })];
    expect(times(run({ staff }))).toEqual(grid("09:00", "16:30"));
  });
});

describe("buffers", () => {
  const busy = [person({ id: "mia", bookings: [booking(DAY, "10:00", "11:00")] })];

  it("lets buffers fall outside working hours", () => {
    const slots = run({
      service: service({ durationMin: 60, bufferBeforeMin: 15, bufferAfterMin: 15 }),
    });
    expect(times(slots)).toEqual(grid("09:00", "16:00"));
  });

  it("keeps the buffer after clear of the next booking", () => {
    const slots = times(run({ staff: busy, service: service({ bufferAfterMin: 15 }) }));
    expect(slots).toContain("09:00"); // 09:00–09:45 blocked
    expect(slots).not.toContain("09:30"); // 09:30–10:15 overlaps 10:00
    expect(slots).toContain("11:00");
  });

  it("keeps the buffer before clear of the previous booking", () => {
    const slots = times(run({ staff: busy, service: service({ bufferBeforeMin: 30 }) }));
    expect(slots).toContain("09:30"); // blocked 09:00–10:00, touching the booking
    expect(slots).not.toContain("11:00"); // blocked from 10:30
    expect(slots).toContain("11:30"); // blocked from 11:00, touching the booking
  });

  it("allows two buffers to touch but not overlap", () => {
    // Existing: 10:00–11:00 with 15 min after → blocked until 11:15.
    const staff = [person({ id: "mia", bookings: [booking(DAY, "09:45", "11:15")] })];
    const quarter = { slotIntervalMin: 15 };
    const slots = times(
      run({ staff, business: quarter, service: service({ bufferBeforeMin: 15 }) }),
    );
    expect(slots).not.toContain("11:15"); // its buffer before starts at 11:00
    expect(slots).toContain("11:30"); // its buffer before starts at 11:15
  });
});

describe("time off", () => {
  it("blocks part of a day, allowing appointments that end as it starts", () => {
    const staff = [person({ id: "mia", timeOff: [away(DAY, "12:00", DAY, "13:00")] })];
    const half = times(run({ staff }));
    expect(half).toContain("11:30");
    expect(half).not.toContain("12:00");
    expect(half).not.toContain("12:30");
    expect(half).toContain("13:00");

    const hour = times(run({ staff, service: service({ durationMin: 60 }) }));
    expect(hour).toContain("11:00");
    expect(hour).not.toContain("11:30");
    expect(hour).toContain("13:00");
  });

  it("trims hours when it covers their start", () => {
    const staff = [person({ id: "mia", timeOff: [away(DAY, "07:00", DAY, "09:30")] })];
    expect(times(run({ staff }))).toEqual(grid("09:30", "16:30"));
  });

  it("blocks whole days, midnight to midnight, and nothing after", () => {
    // Thu 12 and Fri 13 Nov off, stored as Thu 00:00 → Sat 00:00.
    const staff = [person({ id: "mia", timeOff: [away(DAY, "00:00", "2026-11-14", "00:00")] })];
    const slots = byDate(run({ staff, day: "2026-11-11", days: 4 }));
    expect(Object.keys(slots)).toEqual(["2026-11-11", "2026-11-14"]);
    expect(slots["2026-11-14"]).toEqual(grid("09:00", "16:30"));
  });

  it("lets buffers fall inside time off", () => {
    const staff = [person({ id: "mia", timeOff: [away(DAY, "12:00", DAY, "13:00")] })];
    const slots = times(
      run({
        staff,
        service: service({ durationMin: 60, bufferBeforeMin: 15, bufferAfterMin: 15 }),
      }),
    );
    expect(slots).toContain("11:00"); // buffer after runs 12:00–12:15
    expect(slots).toContain("13:00"); // buffer before runs 12:45–13:00
  });

  it("only affects the person who's away", () => {
    const slots = run({
      staffId: "any",
      staff: [
        person({ id: "mia", timeOff: [away(DAY, "00:00", nextDate(DAY), "00:00")] }),
        person({ id: "jonah", sortOrder: 1 }),
      ],
    });
    expect(times(slots)).toEqual(grid("09:00", "16:30"));
    expect(slots.every((s) => s.staffId === "jonah")).toBe(true);
  });
});

describe("minimum notice", () => {
  it("starts at the first grid time at least the notice after now", () => {
    const slots = run({ now: at(DAY, "10:10"), business: { minNoticeMin: 120 } });
    expect(times(slots)[0]).toBe("12:30");
  });

  it("includes a start exactly the notice after now", () => {
    const slots = run({ now: at(DAY, "10:00"), business: { minNoticeMin: 120 } });
    expect(times(slots)[0]).toBe("12:00");
  });

  it("never offers a time that has already started, even with no notice", () => {
    const slots = run({ now: at(DAY, "10:10"), business: { minNoticeMin: 0 } });
    expect(times(slots)[0]).toBe("10:30");
  });

  it("can push the first slot to a later day", () => {
    const slots = run({ now: at(DAY, "16:00"), business: { minNoticeMin: 24 * 60 }, days: 2 });
    expect(byDate(slots)).toEqual({ "2026-11-13": ["16:00", "16:30"] });
  });

  it("offers nothing when the whole query is in the past", () => {
    expect(run({ now: at("2026-11-20", "08:00") })).toEqual([]);
  });
});

describe("maximum days ahead", () => {
  it("allows today plus maxDaysAhead local dates, all day on the last one", () => {
    const slots = byDate(
      run({
        now: at("2026-11-11", "10:00"),
        business: { maxDaysAhead: 1 },
        day: "2026-11-11",
        days: 4,
      }),
    );
    expect(Object.keys(slots)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(slots["2026-11-11"]?.[0]).toBe("10:00");
    expect(slots["2026-11-12"]).toEqual(grid("09:00", "16:30")); // past now's time of day
  });

  it("counts days from today in the business timezone, not UTC", () => {
    // 17:00 UTC on 11 Nov is already 01:00 on 12 Nov in Manila.
    const slots = byDate(
      run({
        now: new Date("2026-11-11T17:00:00Z"),
        business: { maxDaysAhead: 1 },
        day: "2026-11-11",
        days: 4,
      }),
    );
    expect(Object.keys(slots)).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("allows a full year at the maximum setting", () => {
    const slots = run({ business: { maxDaysAhead: 365 }, day: "2027-11-01" }); // NOW is 1 Nov 2026
    expect(times(slots)).toEqual(grid("09:00", "16:30"));
    expect(run({ business: { maxDaysAhead: 365 }, day: "2027-11-02" })).toEqual([]);
  });
});

describe("who can be booked", () => {
  it("offers nothing for a deactivated staff member", () => {
    expect(run({ staff: [person({ id: "mia", active: false })] })).toEqual([]);
  });

  it("offers nothing for someone who doesn't do the service", () => {
    expect(run({ staff: [person({ id: "mia", serviceIds: ["colour"] })] })).toEqual([]);
  });

  it("offers nothing for an unknown staff id", () => {
    expect(run({ staffId: "nobody" })).toEqual([]);
  });

  it('leaves deactivated staff and those who don\'t do the service out of "any"', () => {
    const slots = run({
      staffId: "any",
      staff: [
        person({ id: "mia", hours: hours([["09:00", "10:00"]]) }),
        person({ id: "jonah", active: false, hours: hours([["10:00", "11:00"]]) }),
        person({ id: "aiko", serviceIds: ["colour"], hours: hours([["11:00", "12:00"]]) }),
      ],
    });
    expect(times(slots)).toEqual(["09:00", "09:30"]);
    expect(slots.every((s) => s.staffId === "mia")).toBe(true);
  });

  it('offers nothing for "any" when nobody can do the service', () => {
    expect(run({ staffId: "any", staff: [person({ id: "mia", active: false })] })).toEqual([]);
  });
});

describe('"anyone available"', () => {
  // Mia works 09:00–12:00, Jonah 10:00–13:00: they overlap 10:00–12:00.
  const mia = (overrides: Partial<SlotStaff> = {}) =>
    person({ id: "mia", sortOrder: 0, hours: hours([["09:00", "12:00"]]), ...overrides });
  const jonah = (overrides: Partial<SlotStaff> = {}) =>
    person({ id: "jonah", sortOrder: 1, hours: hours([["10:00", "13:00"]]), ...overrides });
  const anyone = (staff: SlotStaff[]) => run({ staffId: "any", staff });
  const assigned = (slots: Slot[]) =>
    Object.fromEntries(slots.map((s) => [zonedParts(s.start, MANILA).time, s.staffId]));

  it("merges everyone's times into one sorted list without duplicates", () => {
    const slots = anyone([mia(), jonah()]);
    expect(times(slots)).toEqual(grid("09:00", "12:30"));
    expect(new Set(iso(slots)).size).toBe(slots.length);
  });

  it("gives a time to the only person free then", () => {
    const who = assigned(anyone([mia(), jonah()]));
    expect(who["09:00"]).toBe("mia");
    expect(who["09:30"]).toBe("mia");
    expect(who["12:00"]).toBe("jonah");
    expect(who["12:30"]).toBe("jonah");
  });

  it("prefers the lower sort order when both are equally busy", () => {
    const who = assigned(anyone([mia(), jonah()]));
    for (const t of grid("10:00", "11:30")) expect(who[t]).toBe("mia");
  });

  it("prefers whoever has fewer bookings that day", () => {
    const who = assigned(anyone([mia({ bookings: [booking(DAY, "09:00", "09:30")] }), jonah()]));
    expect(who["09:00"]).toBeUndefined(); // Mia is booked and Jonah isn't in yet
    expect(who["09:30"]).toBe("mia");
    for (const t of grid("10:00", "11:30")) expect(who[t]).toBe("jonah");
  });

  it("counts only that day's pending and confirmed bookings", () => {
    const who = assigned(
      anyone([
        mia({
          bookings: [
            booking("2026-11-11", "09:00", "10:00"),
            booking(DAY, "09:00", "09:30", { status: "cancelled" }),
          ],
        }),
        jonah(),
      ]),
    );
    for (const t of grid("10:00", "11:30")) expect(who[t]).toBe("mia");
  });

  it("falls back to whoever is free, even if they're busier", () => {
    const who = assigned(
      anyone([
        mia({ bookings: [booking(DAY, "10:00", "10:30")] }),
        jonah({ bookings: [booking(DAY, "11:00", "12:00"), booking(DAY, "12:00", "13:00")] }),
      ]),
    );
    expect(who["10:00"]).toBe("jonah"); // Mia is booked
    expect(who["10:30"]).toBe("mia"); // both free, Mia has fewer bookings
    expect(who["11:00"]).toBe("mia"); // Jonah is booked
    expect(who["11:30"]).toBe("mia");
  });

  it("breaks a sort-order tie by the order staff were given", () => {
    const who = assigned(anyone([jonah({ sortOrder: 0 }), mia({ sortOrder: 0 })]));
    for (const t of grid("10:00", "11:30")) expect(who[t]).toBe("jonah");
  });

  it("assigns per day across a multi-day query", () => {
    // Mia is busier on the 12th only.
    const slots = run({
      staffId: "any",
      days: 2,
      staff: [mia({ bookings: [booking(DAY, "09:00", "09:30")] }), jonah()],
    });
    const at10 = (date: string) =>
      slots.find((s) => s.start.getTime() === at(date, "10:00").getTime())?.staffId;
    expect(at10(DAY)).toBe("jonah");
    expect(at10("2026-11-13")).toBe("mia");
  });
});

describe("DST in America/New_York", () => {
  const ny = { timezone: NY };
  const springNow = new Date("2026-02-20T12:00:00Z");
  const fallNow = new Date("2026-10-20T12:00:00Z");
  /** Hours 00:00–04:00 every day: they cross the 2 a.m. change. */
  const nightOwl = [person({ id: "mia", hours: hours([["00:00", "04:00"]]) })];

  it("keeps 09:00 local across the spring change (Sun 8 Mar)", () => {
    const slots = run({ business: ny, now: springNow, day: "2026-03-07", days: 3 });
    expect(byDate(slots, NY)).toEqual({
      "2026-03-07": grid("09:00", "16:30"),
      "2026-03-08": grid("09:00", "16:30"),
      "2026-03-09": grid("09:00", "16:30"),
    });
    const firstOn = (date: string) =>
      slots.find((s) => zonedParts(s.start, NY).date === date)?.start.toISOString();
    expect(firstOn("2026-03-07")).toBe("2026-03-07T14:00:00.000Z"); // EST, UTC-5
    expect(firstOn("2026-03-08")).toBe("2026-03-08T13:00:00.000Z"); // EDT, UTC-4
  });

  it("keeps 09:00 local across the autumn change (Sun 1 Nov)", () => {
    const slots = run({ business: ny, now: fallNow, day: "2026-10-31", days: 2 });
    expect(byDate(slots, NY)).toEqual({
      "2026-10-31": grid("09:00", "16:30"),
      "2026-11-01": grid("09:00", "16:30"),
    });
    expect(slots[0]?.start.toISOString()).toBe("2026-10-31T13:00:00.000Z"); // EDT
    const sunday = slots.find((s) => zonedParts(s.start, NY).date === "2026-11-01");
    expect(sunday?.start.toISOString()).toBe("2026-11-01T14:00:00.000Z"); // EST
  });

  it("skips the hour that doesn't exist in spring", () => {
    const slots = run({ business: ny, now: springNow, day: "2026-03-08", staff: nightOwl });
    expect(times(slots, NY)).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30"]);
    expect(iso(slots)).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-08T05:30:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T06:30:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T07:30:00.000Z",
    ]);
  });

  it("measures duration in real time across the spring jump", () => {
    const slots = run({
      business: ny,
      now: springNow,
      day: "2026-03-08",
      staff: nightOwl,
      service: service({ durationMin: 60 }),
    });
    // 00:00–04:00 that night is only 3 real hours.
    expect(times(slots, NY)).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00"]);
    const at0130 = slots.find((s) => zonedParts(s.start, NY).time === "01:30");
    expect(at0130?.end.toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
  });

  it("offers nothing for hours that fall entirely in the skipped hour", () => {
    const staff = [person({ id: "mia", hours: hours([["02:00", "03:00"]]) })];
    expect(run({ business: ny, now: springNow, day: "2026-03-08", staff })).toEqual([]);
  });

  it("offers the repeated hour twice in autumn, as different instants", () => {
    const slots = run({ business: ny, now: fallNow, day: "2026-11-01", staff: nightOwl });
    // 00:00–04:00 that night is 5 real hours.
    expect(times(slots, NY)).toEqual([
      "00:00",
      "00:30",
      "01:00",
      "01:30",
      "01:00",
      "01:30",
      "02:00",
      "02:30",
      "03:00",
      "03:30",
    ]);
    expect(iso(slots)).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T04:30:00.000Z",
      "2026-11-01T05:00:00.000Z", // 01:00 EDT
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:00:00.000Z", // 01:00 EST
      "2026-11-01T06:30:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T07:30:00.000Z",
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T08:30:00.000Z",
    ]);
  });

  it("ends all-day time off at the next local midnight on a 23-hour day", () => {
    // Sun 8 Mar off: 05:00Z → Mon 9 Mar 04:00Z.
    const staff = [
      person({
        id: "mia",
        hours: hours([["00:00", "04:00"]]),
        timeOff: [away("2026-03-08", "00:00", "2026-03-09", "00:00", NY)],
      }),
    ];
    const slots = run({ business: ny, now: springNow, day: "2026-03-08", days: 2, staff });
    expect(Object.keys(byDate(slots, NY))).toEqual(["2026-03-09"]);
    expect(slots[0]?.start.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("ends all-day time off at the next local midnight on a 25-hour day", () => {
    // Sun 1 Nov off: 04:00Z → Mon 2 Nov 05:00Z.
    const staff = [
      person({
        id: "mia",
        hours: hours([["00:00", "04:00"]]),
        timeOff: [away("2026-11-01", "00:00", "2026-11-02", "00:00", NY)],
      }),
    ];
    const slots = run({ business: ny, now: fallNow, day: "2026-11-01", days: 2, staff });
    expect(Object.keys(byDate(slots, NY))).toEqual(["2026-11-02"]);
    expect(slots[0]?.start.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("measures minimum notice in real time across the change", () => {
    // Sat 7 Mar 10:00 EST + 24 h = Sun 8 Mar 11:00 EDT, not 10:00.
    const slots = run({
      business: { ...ny, minNoticeMin: 24 * 60 },
      now: at("2026-03-07", "10:00", NY),
      day: "2026-03-08",
    });
    expect(times(slots, NY)[0]).toBe("11:00");
  });
});

describe("Asia/Manila business viewed from Europe/London", () => {
  // Mon–Fri 10:00–19:00 and Sat 07:00–12:00 in Manila (UTC+8).
  const staff = [
    person({
      id: "mia",
      hours: [...hours([["10:00", "19:00"]], WEEKDAYS), ...hours([["07:00", "12:00"]], [6])],
    }),
  ];
  /** One calendar day in London. */
  const londonDay = (date: string, extra: Partial<Run> = {}) =>
    run({
      staff,
      from: at(date, "00:00", LONDON),
      to: at(nextDate(date), "00:00", LONDON),
      ...extra,
    });

  it("shows a Manila day early in the London morning (GMT)", () => {
    const slots = londonDay("2026-11-13"); // Friday
    expect(times(slots, LONDON)).toEqual([...grid("02:00", "10:30"), "23:00", "23:30"]);
  });

  it("includes the next Manila day's early slots late on the London day", () => {
    const slots = londonDay("2026-11-13");
    const late = slots.filter((s) => zonedParts(s.start, LONDON).time >= "23:00");
    expect(late.map((s) => zonedParts(s.start, MANILA))).toEqual([
      { date: "2026-11-14", time: "07:00" },
      { date: "2026-11-14", time: "07:30" },
    ]);
  });

  it("leaves the Manila slots already shown on Friday off London's Saturday", () => {
    expect(times(londonDay("2026-11-14"), LONDON)).toEqual(grid("00:00", "03:30"));
  });

  it("returns the same instants whichever timezone the window is drawn in", () => {
    const manilaSaturday = run({ staff, day: "2026-11-14" });
    const london = [...londonDay("2026-11-13"), ...londonDay("2026-11-14")];
    const fromLondon = new Set(iso(london));
    expect(times(manilaSaturday)).toEqual(grid("07:00", "11:30"));
    for (const slot of iso(manilaSaturday)) expect(fromLondon.has(slot)).toBe(true);
  });

  it("shifts by an hour for London in summer (BST)", () => {
    const slots = londonDay("2026-07-10", { now: new Date("2026-06-20T00:00:00Z") });
    expect(times(slots, LONDON)).toEqual(grid("03:00", "11:30"));
  });

  it("applies minimum notice to the instant, whoever is looking", () => {
    // 03:00 London = 11:00 Manila; an hour's notice → 12:00 Manila = 04:00 London.
    const slots = londonDay("2026-11-13", {
      now: new Date("2026-11-13T03:00:00Z"),
      business: { minNoticeMin: 60 },
    });
    expect(times(slots, LONDON)).toEqual([...grid("04:00", "10:30"), "23:00", "23:30"]);
  });
});

describe("labels for the customer's clock", () => {
  const fallNow = new Date("2026-10-20T12:00:00Z");
  const nightOwl = [person({ id: "mia", hours: hours([["00:00", "04:00"]]) })];

  it("tells the two readings of a repeated autumn hour apart", () => {
    const slots = run({
      business: { timezone: NY },
      now: fallNow,
      day: "2026-11-01",
      staff: nightOwl,
    });
    const labels = slots.map((s) => s.local);
    expect(labels.slice(2, 6)).toEqual([
      { date: "2026-11-01", time: "01:00", offset: "-04:00", zone: "EDT", repeated: "first" },
      { date: "2026-11-01", time: "01:30", offset: "-04:00", zone: "EDT", repeated: "first" },
      { date: "2026-11-01", time: "01:00", offset: "-05:00", zone: "EST", repeated: "second" },
      { date: "2026-11-01", time: "01:30", offset: "-05:00", zone: "EST", repeated: "second" },
    ]);
    // Every other time happens once.
    expect(labels.filter((l) => l.repeated === null).map((l) => l.time)).toEqual([
      "00:00",
      "00:30",
      "02:00",
      "02:30",
      "03:00",
      "03:30",
    ]);
    // Time plus zone is enough to tell every slot apart.
    expect(new Set(labels.map((l) => `${l.time} ${l.zone}`)).size).toBe(slots.length);
  });

  it("never marks a spring-forward night as repeated", () => {
    const slots = run({
      business: { timezone: NY },
      now: new Date("2026-02-20T12:00:00Z"),
      day: "2026-03-08",
      staff: nightOwl,
    });
    expect(slots.map((s) => [s.local.time, s.local.zone, s.local.repeated])).toEqual([
      ["00:00", "EST", null],
      ["00:30", "EST", null],
      ["01:00", "EST", null],
      ["01:30", "EST", null],
      ["03:00", "EDT", null],
      ["03:30", "EDT", null],
    ]);
  });

  it("labels in the business timezone by default", () => {
    const [first] = run();
    expect(first?.local).toEqual({
      date: DAY,
      time: "09:00",
      offset: "+08:00",
      zone: "GMT+8",
      repeated: null,
    });
  });

  it("labels in the customer's timezone when given", () => {
    const [first] = run({ displayTimezone: LONDON });
    expect(first?.local).toEqual({
      date: DAY,
      time: "01:00",
      offset: "+00:00",
      zone: "GMT",
      repeated: null,
    });
  });

  it("flags the customer's repeated hour even when the business has none", () => {
    // 13:00–15:00 in Manila on 1 Nov is 01:00 EDT – 02:00 EST in New York.
    const staff = [person({ id: "mia", hours: hours([["13:00", "15:00"]]) })];
    const slots = run({ staff, day: "2026-11-01", now: fallNow, displayTimezone: NY });
    expect(slots.map((s) => `${s.local.time} ${s.local.zone} ${s.local.repeated}`)).toEqual([
      "01:00 EDT first",
      "01:30 EDT first",
      "01:00 EST second",
      "01:30 EST second",
    ]);
  });
});
