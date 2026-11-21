import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Follow-up work (emails, job events) waits for the response inside a
 * request, and runs straight away outside one (tests, scripts).
 */

const next = vi.hoisted(() => ({ inRequest: false, queued: [] as (() => Promise<unknown>)[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    if (!next.inRequest) throw new Error("`after` was called outside a request scope.");
    next.queued.push(task);
  },
}));

const { afterResponse } = await import("@/server/after-response");

describe("afterResponse", () => {
  afterEach(() => {
    next.inRequest = false;
    next.queued.length = 0;
    vi.restoreAllMocks();
  });

  it("outside a request, runs the work now and returns its result", async () => {
    const work = vi.fn().mockResolvedValue(true);
    expect(await afterResponse(work, false)).toBe(true);
    expect(work).toHaveBeenCalledOnce();
  });

  it("in a request, leaves the work until after the response and says what to expect", async () => {
    next.inRequest = true;
    const work = vi.fn().mockResolvedValue(true);
    expect(await afterResponse(work, false)).toBe(false);
    expect(work).not.toHaveBeenCalled();
    await next.queued[0]!();
    expect(work).toHaveBeenCalledOnce();
  });

  it("logs a failure instead of throwing it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await afterResponse(() => Promise.reject(new Error("Resend down")), null)).toBeNull();
    expect(log).toHaveBeenCalledWith("[after] follow-up work failed", expect.any(Error));
  });
});
