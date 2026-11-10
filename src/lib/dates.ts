import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * An instant as it reads in `zone` ("7 Nov", "7 November"). The same text on
 * the server and in every browser, whatever their own timezone: never use
 * Intl or toLocale…String without a timeZone for business dates.
 */
export function formatInZone(instant: Date, zone: string, pattern: string): string {
  return format(new TZDate(instant.getTime(), zone), pattern);
}
