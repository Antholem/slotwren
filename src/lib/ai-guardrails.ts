import { nextDate, zonedInstant, zonedParts } from "./time-off";

/*
 * The AI receptionist's guardrails (step 4.6), the parts that are pure:
 * the monthly token budget's window and state, what the chat says when a
 * guardrail stops it, and cleaning model replies before they're shown.
 * Client-safe.
 */

/** The owner hears about it once a month at this share of the budget. */
export const BUDGET_WARNING_RATIO = 0.8;

/** Shown when the business has used its monthly AI budget. Hand-off still works. */
export const RESTING_MESSAGE =
  "The assistant is resting for this month. You can still book on this page.";

/** Ends a reply cut short because the shared daily cap was reached between tool steps. */
export const CAPPED_MESSAGE =
  "I've had to stop there: the assistant is very busy right now. You can still book on this page.";

/** Shown when the shared daily cap is reached or the AI provider refuses (429, quota, overload). */
export const UNAVAILABLE_MESSAGE =
  "The assistant isn't available right now. You can still book on this page.";

/**
 * What the prompt holds of the business's own writing, in characters: every
 * message (and every tool step) resends it, so it's bounded whatever the
 * owner writes. FAQs in their order until the total is reached; each service
 * description up to its cap. The FAQ editor shows owners how much is used.
 */
export const PROMPT_LIMITS = { faqChars: 8_000, serviceDescriptionChars: 300 } as const;

/** Tokens one conversation may use in all (every turn resends the prompt). */
export const CONVERSATION_TOKEN_LIMIT = 80_000;

/** Shown when a conversation has used its tokens: a new chat starts fresh. */
export const CONVERSATION_LIMIT_MESSAGE =
  "This chat has reached its limit. Start a new chat to keep going.";

export type BudgetState = "ok" | "warning" | "exhausted";

export function budgetState(used: number, budget: number): BudgetState {
  if (budget <= 0 || used >= budget) return "exhausted";
  if (used >= budget * BUDGET_WARNING_RATIO) return "warning";
  return "ok";
}

/**
 * This calendar month in the business's timezone: the budget resets at
 * midnight on the 1st there, not in UTC. `period` names it ("2026-11").
 */
export function monthWindow(now: Date, zone: string): { start: Date; end: Date; period: string } {
  const today = zonedParts(now, zone).date;
  const first = `${today.slice(0, 8)}01`;
  // The 1st of next month: from the 28th, step until the month changes.
  let next = nextDate(first, 28);
  while (next.slice(5, 7) === first.slice(5, 7)) next = nextDate(next);
  next = `${next.slice(0, 8)}01`;
  return {
    start: zonedInstant(first, "00:00", zone),
    end: zonedInstant(next, "00:00", zone),
    period: first.slice(0, 7),
  };
}

// ── replies ───────────────────────────────────────────────────────────

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi;
const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;
const TAG = /<\/?[a-z][^>]*>/gi;

/**
 * A model reply as plain text with only the business's own links: its booking
 * page (and manage links) on this site. Any other URL becomes "[link
 * removed]", HTML tags go, and a Markdown link keeps its text (plus the URL
 * when it's allowed). The model is told the same; this makes it so.
 */
export function sanitizeReply(text: string, { origin, slug }: { origin: string; slug: string }) {
  const allowed = (raw: string) => {
    try {
      const url = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
      const site = new URL(origin);
      return (
        url.protocol === site.protocol &&
        url.host === site.host &&
        (url.pathname === `/b/${slug}` ||
          url.pathname.startsWith(`/b/${slug}/`) ||
          url.pathname.startsWith("/m/"))
      );
    } catch {
      return false;
    }
  };
  // Trailing punctuation belongs to the sentence, not the link.
  const split = (raw: string): [string, string] => {
    const match = /[.,;:!?]+$/.exec(raw);
    return match ? [raw.slice(0, -match[0].length), match[0]] : [raw, ""];
  };
  return text
    .replace(MARKDOWN_LINK, (_, label: string, href: string) =>
      allowed(href) ? `${label} (${href})` : label,
    )
    .replace(TAG, "")
    .replace(URL_PATTERN, (raw) => {
      const [url, tail] = split(raw);
      return (allowed(url) ? url : "[link removed]") + tail;
    });
}
