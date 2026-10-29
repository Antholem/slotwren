import { describe, expect, it } from "vitest";

import { BOOKING_CODE_PATTERN, generateBookingCode } from "@/server/booking/codes";
import { generateToken, hashToken } from "@/server/booking/tokens";

describe("generateBookingCode", () => {
  it("matches the SW-XXXX-NN format from the mockups", () => {
    expect("SW-8K3D-27").toMatch(BOOKING_CODE_PATTERN);
    for (let i = 0; i < 500; i++) expect(generateBookingCode()).toMatch(BOOKING_CODE_PATTERN);
  });

  it("never uses easily confused characters", () => {
    const letters = Array.from({ length: 500 }, () => generateBookingCode().slice(3, 7)).join("");
    expect(letters).not.toMatch(/[01OILU]/);
  });
});

describe("manage tokens", () => {
  it("are long, random and stored only as a stable hash", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});
