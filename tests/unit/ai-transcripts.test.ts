import { describe, expect, it } from "vitest";

import {
  classifyOutcome,
  parseTranscriptFilters,
  transcriptFiltersQuery,
} from "@/lib/ai-transcripts";

describe("transcript filters in the URL", () => {
  it("defaults to the last 30 days, page 1, nothing open", () => {
    expect(parseTranscriptFilters({})).toEqual({
      q: "",
      outcome: null,
      range: "past30",
      from: null,
      to: null,
      page: 1,
      c: null,
    });
    expect(transcriptFiltersQuery(parseTranscriptFilters({}))).toBe("");
  });

  it("round-trips every filter, and drops junk", () => {
    const id = "6f1c2b9a-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
    const query = transcriptFiltersQuery({
      q: "ana",
      outcome: "handed_off",
      range: "custom",
      from: "2026-11-01",
      to: "2026-11-24",
      page: 3,
      c: id,
    });
    expect(parseTranscriptFilters(new URLSearchParams(query))).toEqual({
      q: "ana",
      outcome: "handed_off",
      range: "custom",
      from: "2026-11-01",
      to: "2026-11-24",
      page: 3,
      c: id,
    });
    expect(
      parseTranscriptFilters({
        outcome: "deleted",
        range: "forever",
        from: "2026-13-45",
        page: "-2",
        c: "not-a-uuid",
        q: ["  two  ", "values"],
      }),
    ).toMatchObject({ outcome: null, range: "past30", from: null, page: 1, c: null, q: "two" });
  });

  it("classifies the most significant outcome", () => {
    const none = { booked: false, rescheduled: false, cancelled: false, handedOff: false };
    expect(classifyOutcome(none)).toBe("none");
    expect(classifyOutcome({ ...none, handedOff: true })).toBe("handed_off");
    expect(classifyOutcome({ ...none, handedOff: true, cancelled: true })).toBe("cancelled");
    expect(classifyOutcome({ ...none, cancelled: true, rescheduled: true })).toBe("rescheduled");
    expect(
      classifyOutcome({ booked: true, rescheduled: true, cancelled: true, handedOff: true }),
    ).toBe("booked");
  });
});
