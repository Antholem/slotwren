import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveBookings } from "@/components/dashboard/live-bookings";

/*
 * The live dashboard's "New booking" toast. Realtime reads the change log
 * with some lag, so an INSERT committed just before the page rendered can
 * arrive after it subscribed: that booking is already on the page, so it
 * refreshes but gets no toast. (This was services.spec's flake: a stale toast
 * fading in while axe measured contrast.)
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

type Handler = (payload: unknown) => void;
const handlers = vi.hoisted(() => ({ insert: null as Handler | null }));

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => {
    const channel = {
      on(_kind: string, filter: { event: string }, handler: Handler) {
        if (filter.event === "INSERT") handlers.insert = handler;
        return channel;
      },
      subscribe(callback: (status: string) => void) {
        // Like Supabase: the status arrives later, never during subscribe().
        queueMicrotask(() => callback("SUBSCRIBED"));
        return channel;
      },
    };
    return {
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
      realtime: { setAuth: async () => {} },
      channel: () => channel,
      removeChannel: async () => {},
    };
  },
}));

afterEach(() => {
  cleanup();
  toast.mockReset();
  handlers.insert = null;
});

const RENDERED_AT = "2026-11-26T03:00:00.000Z";

const insert = (id: string, createdAt: string) => ({
  eventType: "INSERT",
  new: {
    id,
    code: "SW-ABCD-12",
    business_id: "b1",
    customer_name: "Ana Santos",
    starts_at: "2026-11-28T02:00:00.000Z",
    source: "page",
    created_by_user_id: null,
    created_at: createdAt,
  },
});

describe("LiveBookings", () => {
  it("toasts bookings made after the page rendered, not ones already on it", async () => {
    render(
      <LiveBookings businessId="b1" userId="u1" zone="Asia/Manila" renderedAt={RENDERED_AT} />,
    );
    await waitFor(() => expect(handlers.insert).not.toBeNull());

    // Committed a second before the render, delivered late: no toast.
    handlers.insert!(insert("old", "2026-11-26T02:59:59.000Z"));
    expect(toast).not.toHaveBeenCalled();

    // Made after: the toast, once per booking.
    handlers.insert!(insert("new", "2026-11-26T03:00:05.000Z"));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "New booking from booking page",
      expect.objectContaining({ id: "new", description: expect.stringContaining("Ana Santos") }),
    );
  });
});
