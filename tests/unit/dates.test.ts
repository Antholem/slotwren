import { describe, expect, it } from "vitest";

import { formatInZone } from "@/lib/dates";

describe("formatInZone", () => {
  // 17:00 UTC on 6 Nov is already 7 Nov in Manila, still 6 Nov in New York.
  const instant = new Date("2026-11-06T17:00:00Z");

  it("reads the date in the business timezone, not the runtime's", () => {
    expect(formatInZone(instant, "Asia/Manila", "d MMM")).toBe("7 Nov");
    expect(formatInZone(instant, "America/New_York", "d MMM")).toBe("6 Nov");
    expect(formatInZone(instant, "Asia/Manila", "d MMMM")).toBe("7 November");
  });

  it("is the same whatever the process timezone is", () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      expect(formatInZone(instant, "America/New_York", "d MMM")).toBe("6 Nov");
      process.env.TZ = "Pacific/Pago_Pago"; // UTC-11
      expect(formatInZone(instant, "Asia/Manila", "d MMM")).toBe("7 Nov");
    } finally {
      process.env.TZ = before;
    }
  });
});
