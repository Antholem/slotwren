import { addDays } from "./today";

/*
 * The Bookings page's filters, as they live in the URL: the page, the CSV
 * export and the table all read them through parseBookingFilters, so the
 * export is exactly what's on screen. Client-safe and pure.
 */

export const STATUSES = ["pending", "confirmed", "completed", "no_show", "cancelled"] as const;
export const SOURCES = ["page", "widget", "ai", "manual"] as const;
export const RANGES = [
  "today",
  "next7",
  "next30",
  "upcoming",
  "past7",
  "past30",
  "all",
  "custom",
] as const;
export const SORTS = ["date", "customer", "price", "status"] as const;

export type BookingStatusFilter = (typeof STATUSES)[number];
export type SourceFilter = (typeof SOURCES)[number];
export type RangeFilter = (typeof RANGES)[number];
export type SortKey = (typeof SORTS)[number];

export type BookingFilters = {
  q: string;
  status: BookingStatusFilter | null;
  staff: string | null;
  service: string | null;
  source: SourceFilter | null;
  range: RangeFilter;
  /** Custom range, business-local dates, both inclusive. */
  from: string | null;
  to: string | null;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
};

export const PAGE_SIZE = 25;

export const RANGE_LABELS: Record<RangeFilter, string> = {
  today: "Today",
  next7: "Next 7 days",
  next30: "Next 30 days",
  upcoming: "All upcoming",
  past7: "Last 7 days",
  past30: "Last 30 days",
  all: "Any time",
  custom: "Custom",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const pick = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const validDate = (value: unknown) =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    ? value
    : null;

/** Read filters from URL search params; anything unknown or malformed falls back to the default. */
export function parseBookingFilters(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
): BookingFilters {
  const get = (key: string) =>
    params instanceof URLSearchParams ? params.get(key) : first(params[key]);
  const q = get("q");
  const page = Number(get("page"));
  const staff = get("staff");
  const service = get("service");
  return {
    q: typeof q === "string" ? q.trim().slice(0, 100) : "",
    status: pick(STATUSES, get("status")),
    staff: typeof staff === "string" && UUID.test(staff) ? staff : null,
    service: typeof service === "string" && UUID.test(service) ? service : null,
    source: pick(SOURCES, get("source")),
    range: pick(RANGES, get("range")) ?? "next7",
    from: validDate(get("from")),
    to: validDate(get("to")),
    sort: pick(SORTS, get("sort")) ?? "date",
    dir: get("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/**
 * The selection after the same view refreshed: whatever is still on screen
 * (and selectable) stays selected. Returns `selected` itself when nothing
 * dropped out, so React can skip the update.
 */
export function retainSelection(selected: Set<string>, visible: readonly string[]): Set<string> {
  const shown = new Set(visible);
  const kept = new Set([...selected].filter((id) => shown.has(id)));
  return kept.size === selected.size ? selected : kept;
}

/** Filters back to a query string, leaving defaults out. */
export function bookingFiltersQuery(filters: Partial<BookingFilters>): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.staff) params.set("staff", filters.staff);
  if (filters.service) params.set("service", filters.service);
  if (filters.source) params.set("source", filters.source);
  if (filters.range && filters.range !== "next7") params.set("range", filters.range);
  if (filters.range === "custom") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  if (filters.sort && filters.sort !== "date") params.set("sort", filters.sort);
  if (filters.dir === "desc") params.set("dir", "desc");
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The date range as business-local dates: `[fromDate, toDate)` (to exclusive),
 * or an open end (null). `upcoming` starts now, not at midnight, and the
 * `past` ranges end now: the caller passes those as instants.
 */
export function rangeDates(
  filters: Pick<BookingFilters, "range" | "from" | "to">,
  today: string,
): { fromDate: string | null; toDate: string | null; fromNow: boolean; untilNow: boolean } {
  switch (filters.range) {
    case "today":
      return { fromDate: today, toDate: addDays(today, 1), fromNow: false, untilNow: false };
    case "next7":
      return { fromDate: today, toDate: addDays(today, 7), fromNow: false, untilNow: false };
    case "next30":
      return { fromDate: today, toDate: addDays(today, 30), fromNow: false, untilNow: false };
    case "upcoming":
      return { fromDate: null, toDate: null, fromNow: true, untilNow: false };
    case "past7":
      return { fromDate: addDays(today, -7), toDate: null, fromNow: false, untilNow: true };
    case "past30":
      return { fromDate: addDays(today, -30), toDate: null, fromNow: false, untilNow: true };
    case "all":
      return { fromDate: null, toDate: null, fromNow: false, untilNow: false };
    case "custom": {
      // A range typed backwards still means the days between.
      const [a, b] =
        filters.from && filters.to && filters.from > filters.to
          ? [filters.to, filters.from]
          : [filters.from, filters.to];
      return {
        fromDate: a ?? null,
        toDate: b ? addDays(b, 1) : null,
        fromNow: false,
        untilNow: false,
      };
    }
  }
}
