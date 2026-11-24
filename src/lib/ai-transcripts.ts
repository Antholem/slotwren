/*
 * The AI receptionist page's transcript filters, as they live in the URL
 * (like the Bookings page): outcome, date range, search, page and the open
 * conversation. Client-safe and pure.
 */

export const OUTCOMES = ["booked", "rescheduled", "cancelled", "handed_off", "none"] as const;
export type TranscriptOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<TranscriptOutcome, string> = {
  booked: "Booked",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  handed_off: "Handed off",
  none: "No action",
};

export const TRANSCRIPT_RANGES = ["today", "past7", "past30", "all", "custom"] as const;
export type TranscriptRange = (typeof TRANSCRIPT_RANGES)[number];

export const TRANSCRIPT_RANGE_LABELS: Record<TranscriptRange, string> = {
  today: "Today",
  past7: "Last 7 days",
  past30: "Last 30 days",
  all: "Last 90 days",
  custom: "Custom",
};

/** Transcripts are deleted after this many days (the retention job). */
export const TRANSCRIPT_RETENTION_DAYS = 90;

export const TRANSCRIPTS_PAGE_SIZE = 20;

export type TranscriptFilters = {
  q: string;
  outcome: TranscriptOutcome | null;
  range: TranscriptRange;
  /** Custom range: business-local dates, both inclusive. */
  from: string | null;
  to: string | null;
  page: number;
  /** The open conversation. */
  c: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const pick = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
const validDate = (value: unknown) =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    ? value
    : null;

/** Read filters from URL search params; anything unknown or malformed falls back to the default. */
export function parseTranscriptFilters(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
): TranscriptFilters {
  const get = (key: string) =>
    params instanceof URLSearchParams ? params.get(key) : first(params[key]);
  const q = get("q");
  const page = Number(get("page"));
  const c = get("c");
  return {
    q: typeof q === "string" ? q.trim().slice(0, 100) : "",
    outcome: pick(OUTCOMES, get("outcome")),
    range: pick(TRANSCRIPT_RANGES, get("range")) ?? "past30",
    from: validDate(get("from")),
    to: validDate(get("to")),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    c: typeof c === "string" && UUID.test(c) ? c.toLowerCase() : null,
  };
}

/** Filters back to a query string ("" or "?…"), leaving defaults out. */
export function transcriptFiltersQuery(filters: Partial<TranscriptFilters>): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.range && filters.range !== "past30") params.set("range", filters.range);
  if (filters.range === "custom") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (filters.c) params.set("c", filters.c);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * A conversation's outcome from what happened in it, most significant first:
 * a booking made beats a move, a cancellation, then a question for the team.
 */
export function classifyOutcome(facts: {
  booked: boolean;
  rescheduled: boolean;
  cancelled: boolean;
  handedOff: boolean;
}): TranscriptOutcome {
  if (facts.booked) return "booked";
  if (facts.rescheduled) return "rescheduled";
  if (facts.cancelled) return "cancelled";
  if (facts.handedOff) return "handed_off";
  return "none";
}

/** One row of the owner's transcript view (src/server/ai/transcript-view.ts builds them). */
export type TranscriptItem =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string; at: string }
  | {
      kind: "tool";
      id: string;
      /** "Checked availability", "Proposed booking"… */
      label: string;
      /** "Sat 28 Nov", "10:00 with Mia"… */
      detail: string | null;
      tone: "neutral" | "success" | "warning";
      at: string;
      /** For the expandable view: what the model sent and what came back. */
      input: unknown;
      output: unknown;
      /** A booking it created or changed, when there is one. */
      bookingId: string | null;
      code: string | null;
    };
