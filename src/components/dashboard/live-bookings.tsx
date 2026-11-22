"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { formatInZone } from "@/lib/dates";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type BookingRow = {
  id: string;
  code: string;
  business_id: string;
  customer_name: string;
  starts_at: string;
  source: "page" | "widget" | "ai" | "manual";
  created_by_user_id: string | null;
};

const SOURCE: Record<BookingRow["source"], string> = {
  page: "booking page",
  widget: "website widget",
  ai: "AI receptionist",
  manual: "the team",
};

const REFRESH_DEBOUNCE_MS = 300;

/** The connection state on <html data-live>: for debugging, and for tests to wait on. */
function setState(state: "connecting" | "subscribed" | "reconnecting") {
  document.documentElement.dataset.live = state;
}
const MAX_RETRY_MS = 30_000;

/**
 * The live dashboard (step 3.8): one Supabase Realtime subscription to this
 * business's bookings. Every new, changed or cancelled booking refreshes the
 * page from the server (Today, Calendar and Bookings all read the database),
 * and new ones get a toast. Realtime checks each change against the member's
 * RLS policy, so other businesses' bookings never arrive
 * (tests/integration/realtime.test.ts).
 *
 * A dropped connection resubscribes with backoff; once it's back, the page
 * refreshes to catch up on anything missed meanwhile.
 */
export function LiveBookings({
  businessId,
  userId,
  zone,
}: {
  businessId: string;
  userId: string;
  zone: string;
}) {
  const router = useRouter();
  const latest = useRef({ router, zone, userId });
  useEffect(() => {
    latest.current = { router, zone, userId };
  });

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;
    let stopped = false;
    let attempt = 0;
    let missed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => latest.current.router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    const announce = (row: BookingRow) => {
      // The member who booked it by hand already saw "Booked …".
      if (row.source === "manual" && row.created_by_user_id === latest.current.userId) return;
      const when = formatInZone(new Date(row.starts_at), latest.current.zone, "EEE d MMM, HH:mm");
      toast(`New booking from ${SOURCE[row.source]}`, {
        description: `${row.customer_name} · ${when}`,
        action: {
          label: "View",
          onClick: () =>
            latest.current.router.push(
              `/app/bookings?range=all&q=${encodeURIComponent(row.code)}&booking=${row.id}` as Route,
            ),
        },
      });
    };

    const onChange = (payload: RealtimePostgresChangesPayload<BookingRow>) => {
      if (payload.eventType === "INSERT") announce(payload.new);
      refresh();
    };

    function subscribe() {
      if (stopped) return;
      const current = supabase
        .channel(`bookings:${businessId}:${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "bookings",
            filter: `business_id=eq.${businessId}`,
          },
          onChange,
        )
        .subscribe((status) => {
          if (current !== channel || stopped) return; // a replaced or closed channel
          if (status === "SUBSCRIBED") {
            setState("subscribed");
            if (missed) refresh();
            missed = false;
            attempt = 0;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            missed = true;
            channel = null;
            setState("reconnecting");
            void supabase.removeChannel(current);
            const delay = Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt++);
            retryTimer = setTimeout(subscribe, delay);
          }
        });
      channel = current;
    }

    // Back online, or back to a tab the browser may have throttled: catch up now.
    const onOnline = () => {
      refresh();
      if (!channel) {
        clearTimeout(retryTimer);
        attempt = 0;
        subscribe();
      }
    };

    setState("connecting");
    // Join with the member's token, not the anonymous key: Realtime checks RLS
    // against it, and a channel joined before the session loads gets nothing.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (stopped || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      subscribe();
    })();
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(refreshTimer);
      window.removeEventListener("online", onOnline);
      if (channel) void supabase.removeChannel(channel);
      delete document.documentElement.dataset.live;
    };
  }, [businessId]);

  return null;
}
