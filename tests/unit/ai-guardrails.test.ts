import { describe, expect, it } from "vitest";

import { budgetState, monthWindow, sanitizeReply } from "@/lib/ai-guardrails";

describe("monthly budget", () => {
  it("is ok below 80%, a warning from 80%, exhausted at 100%", () => {
    expect(budgetState(395_000, 500_000)).toBe("ok"); // 79%
    expect(budgetState(399_999, 500_000)).toBe("ok");
    expect(budgetState(400_000, 500_000)).toBe("warning"); // 80%
    expect(budgetState(499_999, 500_000)).toBe("warning");
    expect(budgetState(500_000, 500_000)).toBe("exhausted"); // 100%
    expect(budgetState(0, 0)).toBe("exhausted");
  });

  it("resets on the 1st in the business's timezone, not UTC", () => {
    // 23:30 on 30 Nov in Los Angeles is already 1 Dec in UTC: still November there.
    const lateNovember = new Date("2026-12-01T07:30:00Z");
    expect(monthWindow(lateNovember, "America/Los_Angeles")).toEqual({
      start: new Date("2026-11-01T07:00:00Z"), // midnight PDT
      end: new Date("2026-12-01T08:00:00Z"), // midnight PST (DST ended in between)
      period: "2026-11",
    });
    // An hour later it's 1 Dec there too.
    expect(monthWindow(new Date("2026-12-01T08:30:00Z"), "America/Los_Angeles").period).toBe(
      "2026-12",
    );
    // In Manila, 1 Dec starts at 16:00 UTC on 30 Nov.
    expect(monthWindow(new Date("2026-11-30T16:30:00Z"), "Asia/Manila")).toMatchObject({
      start: new Date("2026-11-30T16:00:00Z"),
      period: "2026-12",
    });
    expect(monthWindow(new Date("2026-12-31T20:00:00Z"), "Asia/Manila").period).toBe("2027-01");
    expect(monthWindow(new Date("2027-02-10T00:00:00Z"), "UTC")).toMatchObject({
      start: new Date("2027-02-01T00:00:00Z"),
      end: new Date("2027-03-01T00:00:00Z"),
    });
  });
});

describe("sanitizeReply", () => {
  const site = { origin: "https://slotwren.app", slug: "lumen-studio" };

  it("keeps plain text and the business's own booking page and manage links", () => {
    expect(sanitizeReply("Book here: https://slotwren.app/b/lumen-studio.", site)).toBe(
      "Book here: https://slotwren.app/b/lumen-studio.",
    );
    expect(sanitizeReply("Manage it at https://slotwren.app/m/abc123", site)).toBe(
      "Manage it at https://slotwren.app/m/abc123",
    );
    expect(sanitizeReply("We're open 9:00 – 18:00.", site)).toBe("We're open 9:00 – 18:00.");
  });

  it("removes other links, other businesses' pages and HTML", () => {
    expect(sanitizeReply("Try https://evil.example/login now!", site)).toBe(
      "Try [link removed] now!",
    );
    expect(sanitizeReply("See www.competitor.com, they're cheaper", site)).toBe(
      "See [link removed], they're cheaper",
    );
    expect(sanitizeReply("Other salon: https://slotwren.app/b/other-salon", site)).toBe(
      "Other salon: [link removed]",
    );
    expect(sanitizeReply("http://slotwren.app/b/lumen-studio", site)).toBe("[link removed]");
    expect(sanitizeReply('<a href="https://x.example">Click</a> <b>now</b>', site)).toBe(
      "Click now",
    );
    expect(sanitizeReply("<script>alert(1)</script>Hi", site)).toBe("alert(1)Hi");
  });

  it("turns Markdown links into their text (and keeps allowed URLs)", () => {
    expect(sanitizeReply("[Pay here](https://pay.example/x)", site)).toBe("Pay here");
    expect(sanitizeReply("[Book](https://slotwren.app/b/lumen-studio)", site)).toBe(
      "Book (https://slotwren.app/b/lumen-studio)",
    );
  });
});
