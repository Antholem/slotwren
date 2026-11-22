import "server-only";

import type { BookingFilters } from "@/lib/bookings-filter";
import { CSV_BOM, csvRow } from "@/lib/csv";
import { formatInZone } from "@/lib/dates";
import type { RlsClaims } from "@/server/db/client";
import { bookingBatches } from "@/server/db/queries/bookings-list";

/*
 * The Bookings export: every booking matching the page's filters, as CSV, in
 * the business timezone. Generated in batches so a large export streams
 * instead of building in memory. Cells are neutralised against formula
 * injection by csvCell (src/lib/csv.ts).
 */

const STATUS = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
} as const;
const SOURCE = {
  page: "Booking page",
  widget: "Website",
  ai: "AI receptionist",
  manual: "Team",
} as const;

export const BOOKINGS_CSV_HEADER = [
  "Code",
  "Date",
  "Start",
  "End",
  "Time zone",
  "Customer",
  "Email",
  "Phone",
  "Service",
  "Staff",
  "Status",
  "Source",
  "Price",
  "Currency",
  "Notes",
];

/** Price cents as "35.00": a plain decimal every spreadsheet reads as a number. */
const amount = (cents: number) => (cents / 100).toFixed(2);

export async function* bookingsCsv(
  claims: RlsClaims,
  businessId: string,
  filters: BookingFilters,
  context: { zone: string; now: Date; today: string; currency: string },
): AsyncGenerator<string> {
  yield CSV_BOM + csvRow(BOOKINGS_CSV_HEADER);
  for await (const batch of bookingBatches(claims, businessId, filters, context)) {
    yield batch
      .map((b) =>
        csvRow([
          b.code,
          formatInZone(b.startsAt, context.zone, "yyyy-MM-dd"),
          formatInZone(b.startsAt, context.zone, "HH:mm"),
          formatInZone(b.endsAt, context.zone, "HH:mm"),
          context.zone,
          b.customerName,
          b.customerEmail,
          b.customerPhone,
          b.serviceName,
          b.staffName,
          STATUS[b.status],
          SOURCE[b.source],
          amount(b.priceCents),
          context.currency,
          b.notes,
        ]),
      )
      .join("");
  }
}
