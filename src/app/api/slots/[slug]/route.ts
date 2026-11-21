import { z } from "zod";

import { SLUG_PATTERN } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timezones";
import { getPublicSlots } from "@/server/booking/public-slots";
import { hashToken } from "@/server/booking/tokens";
import { findBookingByManageToken } from "@/server/db/queries/public/bookings";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

/*
 * GET /api/slots/<slug>?service=<id>&staff=<id|any>&from=<ISO>&to=<ISO>&tz=<IANA>[&manage=<token>]
 *
 * Open and taken times for the booking page's time step. The window is a
 * stretch of days in the customer's timezone (at most two weeks), which only
 * the browser knows. Public fields only; never cached. `manage` (a manage
 * link's token) leaves that booking out, so it can move into its own time.
 */

const MAX_WINDOW_MS = 15 * 86_400_000;

const query = z
  .object({
    service: z.uuid(),
    staff: z.union([z.literal("any"), z.uuid()]),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    tz: z.string().max(64).refine(isValidTimeZone),
    // Rescheduling: the manage link's token, so the booking's own time is free.
    manage: z.string().max(64).optional(),
  })
  .transform((q) => ({ ...q, from: new Date(q.from), to: new Date(q.to) }))
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= MAX_WINDOW_MS);

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: RouteContext<"/api/slots/[slug]">) {
  const { slug } = await params;
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business) return json({ error: "Not found" }, 404);

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: "Bad request" }, 400);
  const { service, staff, from, to, tz, manage } = parsed.data;
  const moving = manage
    ? await findBookingByManageToken({ tokenHash: hashToken(manage), now: new Date() })
    : null;
  if (manage && moving?.businessId !== business.id) return json({ error: "Not found" }, 404);

  const slots = await getPublicSlots({
    businessId: business.id,
    serviceId: service,
    staffId: staff,
    from,
    to,
    timezone: tz,
    excludeBookingId: moving?.bookingId,
  });
  return slots ? json(slots) : json({ error: "Not found" }, 404);
}
