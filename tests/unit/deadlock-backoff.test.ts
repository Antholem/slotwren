import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { deadlockBackoffMs } = await import("@/server/booking/service");

/*
 * A booking that lost a deadlock waits a short random time before trying
 * again, longer with each attempt, so two losers don't collide again.
 */
describe("deadlockBackoffMs", () => {
  it("is 10–40 ms on the first retry and grows with each attempt", () => {
    expect(deadlockBackoffMs(1, () => 0)).toBe(10);
    expect(deadlockBackoffMs(1, () => 1)).toBe(40);
    expect(deadlockBackoffMs(2, () => 0)).toBe(20);
    expect(deadlockBackoffMs(2, () => 1)).toBe(80);
  });

  it("differs between two callers (random)", () => {
    const waits = new Set(Array.from({ length: 20 }, () => deadlockBackoffMs(1)));
    expect(waits.size).toBeGreaterThan(1);
  });
});
