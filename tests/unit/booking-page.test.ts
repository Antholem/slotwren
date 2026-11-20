import { describe, expect, it } from "vitest";

import {
  type BookingPageData,
  bookingHref,
  bookingSearch,
  cancellationPolicy,
  chipLabel,
  nearestOpenings,
  parseBookingState,
  periodOf,
  fromNow,
  manageHref,
  parseManageState,
  relativeDay,
  type SlotChip,
} from "@/lib/booking-page";

const CUT = "11111111-1111-4111-8111-111111111111";
const COLOUR = "22222222-2222-4222-8222-222222222222";
const MIA = "33333333-3333-4333-8333-333333333333";
const JONAH = "44444444-4444-4444-8444-444444444444";

const data: BookingPageData = {
  business: {
    id: "b",
    slug: "lumen-studio",
    name: "Lumen Studio",
    logoUrl: null,
    brandColor: "#0F766E",
    address: null,
    timezone: "Asia/Manila",
    currency: "USD",
    cancellationWindowHours: 24,
    maxDaysAhead: 60,
    openingHours: [],
  },
  services: [
    { id: CUT, name: "Haircut", durationMin: 45, priceCents: 3500 },
    { id: COLOUR, name: "Colour", durationMin: 90, priceCents: 8000 },
  ],
  staff: [
    { id: MIA, name: "Mia", title: null, color: "teal", serviceIds: [CUT, COLOUR] },
    { id: JONAH, name: "Jonah", title: null, color: "violet", serviceIds: [CUT] },
  ],
};

const START = "2026-11-24T02:00:00.000Z";

describe("parseBookingState", () => {
  it("starts at the service step with Anyone available", () => {
    expect(parseBookingState({}, data)).toEqual({
      step: "service",
      serviceId: null,
      staffId: "any",
      date: null,
      start: null,
      taken: null,
    });
  });

  it("reads a full details-step URL", () => {
    expect(
      parseBookingState(
        { step: "details", service: CUT, staff: JONAH, date: "2026-11-24", start: START },
        data,
      ),
    ).toEqual({
      step: "details",
      serviceId: CUT,
      staffId: JONAH,
      date: "2026-11-24",
      start: START,
      taken: null,
    });
  });

  it("falls back to the first missing choice", () => {
    expect(parseBookingState({ step: "time" }, data).step).toBe("service");
    expect(parseBookingState({ step: "details", service: CUT }, data).step).toBe("time");
    expect(parseBookingState({ step: "nonsense", service: CUT }, data).step).toBe("service");
  });

  it("drops what this business doesn't offer", () => {
    const state = parseBookingState(
      { step: "staff", service: "55555555-5555-4555-8555-555555555555", staff: MIA },
      data,
    );
    expect(state).toMatchObject({ step: "service", serviceId: null, staffId: "any" });
    // Jonah doesn't do colour.
    expect(parseBookingState({ step: "time", service: COLOUR, staff: JONAH }, data).staffId).toBe(
      "any",
    );
  });

  it("ignores malformed dates, instants and repeated params", () => {
    const state = parseBookingState(
      { step: "time", service: [CUT, COLOUR], date: "24/11/2026", start: "tomorrow" },
      data,
    );
    expect(state).toMatchObject({ step: "service", date: null, start: null });
    expect(
      parseBookingState({ service: CUT, start: "2026-11-24T02:00:00+08:00" }, data).start,
    ).toBe(null);
  });
});

describe("bookingSearch / bookingHref", () => {
  it("writes only what's set, in a stable order", () => {
    expect(bookingSearch({})).toBe("");
    expect(bookingSearch({ step: "staff", serviceId: CUT, staffId: "any" })).toBe(
      `?step=staff&service=${CUT}&staff=any`,
    );
    expect(bookingHref("lumen-studio", { step: "service", serviceId: CUT })).toBe(
      `/b/lumen-studio?service=${CUT}`,
    );
  });

  it("round-trips through parseBookingState", () => {
    const state = {
      step: "details" as const,
      serviceId: CUT,
      staffId: MIA,
      date: "2026-11-24",
      start: START,
      taken: null,
    };
    const params = Object.fromEntries(new URLSearchParams(bookingSearch(state)));
    expect(parseBookingState(params, data)).toEqual(state);
  });
});

describe("periodOf", () => {
  it("splits the day at 12:00 and 17:00", () => {
    expect(["00:00", "11:59", "12:00", "16:30", "17:00", "23:30"].map(periodOf)).toEqual([
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
    ]);
  });
});

const chip = (start: string, time: string): SlotChip => ({
  start,
  end: start,
  staffId: MIA,
  date: "2026-11-24",
  time,
  offset: "+08:00",
  zone: "GMT+8",
  repeated: null,
});

describe("nearestOpenings", () => {
  const day = [
    chip("2026-11-24T01:00:00.000Z", "09:00"),
    chip("2026-11-24T04:30:00.000Z", "12:30"),
    chip("2026-11-24T06:00:00.000Z", "14:00"),
    chip("2026-11-24T07:30:00.000Z", "15:30"),
    chip("2026-11-24T08:00:00.000Z", "16:00"),
  ];

  it("offers the closest times to the one that was taken, in order", () => {
    const near = nearestOpenings(day, "2026-11-24T06:30:00.000Z");
    expect(near.map((s) => s.time)).toEqual(["14:00", "15:30", "16:00"]);
  });

  it("prefers the earlier time on a tie, and never the taken time itself", () => {
    const near = nearestOpenings(day, "2026-11-24T06:00:00.000Z", 2);
    expect(near.map((s) => s.time)).toEqual(["12:30", "15:30"]);
  });

  it("returns what there is when the day is nearly full", () => {
    expect(nearestOpenings(day.slice(0, 1), "2026-11-24T06:00:00.000Z")).toHaveLength(1);
    expect(nearestOpenings([], "2026-11-24T06:00:00.000Z")).toEqual([]);
  });
});

describe("chipLabel", () => {
  it("adds the zone only to the repeated autumn hour", () => {
    expect(chipLabel({ time: "09:00", zone: "EST", repeated: null })).toBe("09:00");
    expect(chipLabel({ time: "01:30", zone: "EDT", repeated: "first" })).toBe("01:30 EDT");
    expect(chipLabel({ time: "01:30", zone: "EST", repeated: "second" })).toBe("01:30 EST");
  });
});

describe("cancellationPolicy", () => {
  it("reads the business's window", () => {
    expect(cancellationPolicy(24)).toBe("Free cancellation up to 24 h before");
    expect(cancellationPolicy(2)).toBe("Free cancellation up to 2 h before");
    expect(cancellationPolicy(72)).toBe("Free cancellation up to 3 days before");
    expect(cancellationPolicy(0)).toBe("Free cancellation until your appointment starts");
  });
});

describe("relativeDay", () => {
  // Wed 18 Nov 2026, 22:00 in Manila (14:00 UTC).
  const now = new Date("2026-11-18T14:00:00Z");

  it("names days on the customer's clock relative to now", () => {
    expect(relativeDay("2026-11-18T15:30:00Z", "Asia/Manila", now)).toBe("Today");
    expect(relativeDay("2026-11-18T16:30:00Z", "Asia/Manila", now)).toBe("Tomorrow"); // 00:30
    expect(relativeDay("2026-11-22T02:00:00Z", "Asia/Manila", now)).toBe("Sun");
    expect(relativeDay("2026-11-25T02:00:00Z", "Asia/Manila", now)).toBe("Wed 25 Nov");
  });

  it("depends on where the customer is", () => {
    // 16:30 UTC is still the 18th in London.
    expect(relativeDay("2026-11-18T16:30:00Z", "Europe/London", now)).toBe("Today");
  });
});

describe("manage page state", () => {
  const TOKEN = "t".repeat(43);

  it("reads the view, time and confirm steps", () => {
    expect(parseManageState({})).toEqual({
      step: "view",
      date: null,
      start: null,
      taken: null,
      done: null,
    });
    expect(parseManageState({ step: "time", date: "2026-11-24", taken: START })).toMatchObject({
      step: "time",
      date: "2026-11-24",
      taken: START,
    });
    expect(parseManageState({ step: "confirm", start: START })).toMatchObject({
      step: "confirm",
      start: START,
    });
    expect(parseManageState({ step: "confirm" }).step).toBe("time");
    expect(parseManageState({ step: "pay", done: "refunded" })).toMatchObject({
      step: "view",
      done: null,
    });
  });

  it("maps the time picker's details step to confirm, and round-trips", () => {
    const href = manageHref(TOKEN, { step: "details", date: "2026-11-24", start: START });
    expect(href).toBe(
      `/m/${TOKEN}?step=confirm&date=2026-11-24&start=${encodeURIComponent(START)}`,
    );
    const params = Object.fromEntries(new URL(href, "https://x.test").searchParams);
    expect(parseManageState(params)).toMatchObject({ step: "confirm", start: START });
    expect(manageHref(TOKEN, { step: "time", start: START })).toBe(`/m/${TOKEN}?step=time`);
    expect(manageHref(TOKEN, { done: "moved" })).toBe(`/m/${TOKEN}?done=moved`);
  });
});

describe("fromNow", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it("says roughly how long is left", () => {
    expect(fromNow(later(30), now)).toBe("in less than an hour");
    expect(fromNow(later(22 * 60 + 10), now)).toBe("about 22 h from now");
    expect(fromNow(later(47 * 60), now)).toBe("about 47 h from now");
    expect(fromNow(later(3 * 24 * 60), now)).toBe("about 3 days from now");
  });
});
