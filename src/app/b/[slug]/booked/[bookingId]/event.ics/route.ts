import { buildIcs } from "@/lib/calendar";
import { loadConfirmation } from "@/server/booking/confirmation";

/** The booking as an .ics file: Apple Calendar, Outlook and the "Download .ics" button. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/b/[slug]/booked/[bookingId]/event.ics">,
) {
  const { slug, bookingId } = await params;
  const confirmation = await loadConfirmation(slug, bookingId);
  if (!confirmation || confirmation.booking.status === "cancelled") {
    return new Response("Not found", { status: 404 });
  }
  const { booking, event, data } = confirmation;
  return new Response(buildIcs(event, new Date()), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${data.business.slug}-${booking.code}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
