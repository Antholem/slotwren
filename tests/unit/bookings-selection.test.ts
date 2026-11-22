import { describe, expect, it } from "vitest";

import { retainSelection } from "@/lib/bookings-filter";

describe("retainSelection (Bookings table after a live refresh)", () => {
  it("keeps selected bookings that are still on screen", () => {
    const selected = new Set(["a", "b", "c"]);
    // A new booking arrived (d) and c moved off the page.
    expect([...retainSelection(selected, ["d", "a", "b"])]).toEqual(["a", "b"]);
  });

  it("returns the same set when nothing dropped out, so React skips the update", () => {
    const selected = new Set(["a", "b"]);
    expect(retainSelection(selected, ["x", "a", "b", "y"])).toBe(selected);
  });

  it("empties when none of the selection is shown any more", () => {
    expect(retainSelection(new Set(["a"]), ["b"]).size).toBe(0);
    expect(retainSelection(new Set(), []).size).toBe(0);
  });
});
