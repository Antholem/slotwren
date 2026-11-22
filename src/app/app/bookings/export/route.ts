import { type NextRequest } from "next/server";

import { parseBookingFilters } from "@/lib/bookings-filter";
import { formatInZone } from "@/lib/dates";
import { todayIn } from "@/lib/time-off";
import { getDashboardContext } from "@/server/auth/dashboard";
import { bookingsCsv } from "@/server/export/bookings-csv";

/**
 * GET /app/bookings/export?<the page's filters>: the matching bookings as a
 * streamed CSV download. Signed-in members only (the proxy, then
 * getDashboardContext), scoped to their current business, read under RLS.
 */
export async function GET(request: NextRequest) {
  const { claims, business } = await getDashboardContext();
  const filters = parseBookingFilters(request.nextUrl.searchParams);
  const now = new Date();
  const zone = business.timezone;
  const chunks = bookingsCsv(claims, business.id, filters, {
    zone,
    now,
    today: todayIn(zone, now),
    currency: business.currency,
  });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  const filename = `${business.slug}-bookings-${formatInZone(now, zone, "yyyy-MM-dd")}.csv`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
