import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TimeStep } from "@/components/booking/time-step";
import type { BookingState, PublicBusinessProfile } from "@/lib/booking-page";

/*
 * What a customer sees when the slots API turns them away (429) or fails:
 * the server's own words for the first, a plain retry for the second.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const business: PublicBusinessProfile = {
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
};
const state: BookingState = {
  step: "time",
  serviceId: "11111111-1111-4111-8111-111111111111",
  staffId: "any",
  date: null,
  start: null,
  taken: null,
};
const renderStep = () =>
  render(
    <TimeStep
      slug="lumen-studio"
      business={business}
      service={{ id: state.serviceId!, name: "Haircut", durationMin: 45, priceCents: 3500 }}
      withWhom="Anyone available"
      canChooseStaff
      state={state}
      now="2026-11-21T02:00:00.000Z"
    />,
  );

describe("TimeStep when loading times fails", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the rate limit's own message, and Try again asks again", async () => {
    const message = "You're checking times very quickly. Wait a moment, then try again.";
    const fetch = vi.fn(async () =>
      Response.json({ error: "rate_limited", message }, { status: 429 }),
    );
    vi.stubGlobal("fetch", fetch);
    renderStep();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Slow down a little");
    expect(alert).toHaveTextContent(message);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("says to check the connection when the server fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    );
    renderStep();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t load the timesCheck your connection and try again.",
    );
  });
});
