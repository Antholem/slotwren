import { describe, expect, it } from "vitest";

import { bookingFiltersQuery, parseBookingFilters, rangeDates } from "@/lib/bookings-filter";
import { csvCell, csvRow } from "@/lib/csv";

describe("csvCell", () => {
  it("quotes every cell and doubles inner quotes", () => {
    expect(csvCell("Ana")).toBe('"Ana"');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(35)).toBe('"35"');
  });

  it.each(["=1+1", "+1-555", "-2+3", "@SUM(A1)", "\t=1", "\r=1", '=HYPERLINK("http://x","y")'])(
    "neutralises a formula: %j",
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    },
  );

  it("leaves ordinary text and our own numbers alone", () => {
    expect(csvCell("Ana-Maria")).toBe('"Ana-Maria"');
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvRow(["a", null, "b"])).toBe('"a",,"b"\r\n');
  });
});

describe("booking filters", () => {
  it("round-trips through the URL, leaving defaults out", () => {
    const filters = parseBookingFilters({
      status: "pending",
      range: "past30",
      sort: "price",
      dir: "desc",
      page: "3",
      q: " ana ",
    });
    expect(filters).toMatchObject({
      status: "pending",
      range: "past30",
      sort: "price",
      dir: "desc",
      page: 3,
      q: "ana",
    });
    expect(bookingFiltersQuery(filters)).toBe(
      "?q=ana&status=pending&range=past30&sort=price&dir=desc&page=3",
    );
    expect(bookingFiltersQuery(parseBookingFilters({}))).toBe("");
    expect(parseBookingFilters(new URLSearchParams("range=today")).range).toBe("today");
  });

  it("turns ranges into local dates", () => {
    expect(rangeDates({ range: "next7", from: null, to: null }, "2026-12-30")).toMatchObject({
      fromDate: "2026-12-30",
      toDate: "2027-01-06",
    });
    expect(
      rangeDates({ range: "custom", from: "2026-12-10", to: "2026-12-01" }, "2026-12-30"),
    ).toMatchObject({
      fromDate: "2026-12-01",
      toDate: "2026-12-11",
    });
    expect(
      rangeDates({ range: "custom", from: null, to: "2026-12-01" }, "2026-12-30"),
    ).toMatchObject({
      fromDate: null,
      toDate: "2026-12-02",
    });
    expect(rangeDates({ range: "upcoming", from: null, to: null }, "2026-12-30").fromNow).toBe(
      true,
    );
  });
});
