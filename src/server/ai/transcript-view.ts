import type { TranscriptItem } from "@/lib/ai-transcripts";
import { formatInZone } from "@/lib/dates";

import { type StoredMessage, toChatMessages } from "./history";

/*
 * A conversation as the owner reads it (/app/ai): the customer's and the
 * assistant's words, and every tool call and confirmation as a compact row
 * ("Checked availability · Sat 28 Nov", "Proposed booking · 10:00 with Mia",
 * "Confirmed · SW-…") that expands to its arguments and result. Pure.
 */

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  typeof value === "object" && value !== null ? (value as Obj) : {};
const str = (value: unknown) => (typeof value === "string" ? value : null);

/** A date the model passed ("2026-11-28", business-local) as "Sat 28 Nov". */
function dayLabel(date: unknown): string | null {
  const d = str(date);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? formatInZone(new Date(`${d}T12:00:00Z`), "UTC", "EEE d MMM")
    : null;
}

function toolRow(
  name: string,
  input: Obj,
  output: Obj,
): Pick<TranscriptItem & { kind: "tool" }, "label" | "detail" | "tone"> {
  const card = obj(output.card);
  const proposed = output.status === "proposed";
  const refused = output.status && output.status !== "ok" && output.status !== "found" && !proposed;
  switch (name) {
    case "checkAvailability": {
      const times = Array.isArray(output.times) ? output.times.length : 0;
      const day = dayLabel(input.date);
      const found =
        output.status === "ok" ? (times ? `${times} free` : "nothing free") : "unknown service";
      return {
        label: "Checked availability",
        detail: [day, found].filter(Boolean).join(" · "),
        tone: "neutral",
      };
    }
    case "listServices":
      return { label: "Listed services", detail: null, tone: "neutral" };
    case "lookUpBooking":
      return {
        label: "Looked up a booking",
        detail: [str(input.code), output.status === "found" ? "found" : "no match"]
          .filter(Boolean)
          .join(" · "),
        tone: "neutral",
      };
    case "proposeBooking":
    case "proposeReschedule":
    case "proposeCancel": {
      const label = {
        proposeBooking: "Proposed booking",
        proposeReschedule: "Proposed a new time",
        proposeCancel: "Proposed cancelling",
      }[name];
      if (!proposed) {
        return { label, detail: str(output.message) ?? "refused", tone: "warning" };
      }
      const time = str(card.time)?.split(" – ")[0];
      const detail =
        name === "proposeCancel"
          ? [str(card.code), str(card.day)].filter(Boolean).join(" · ")
          : `${str(card.day) ?? ""} · ${time ?? ""} with ${str(card.staff) ?? ""} · not booked yet`;
      return { label, detail, tone: "neutral" };
    }
    case "offerHandoff":
      return {
        label: "Offered to pass it to the team",
        detail: str(input.question),
        tone: "warning",
      };
    default:
      return { label: name, detail: null, tone: refused ? "warning" : "neutral" };
  }
}

export function buildTranscriptItems(
  rows: (StoredMessage & { createdAt: Date })[],
  {
    bookingIdByCode,
    clean = (text) => text,
  }: {
    bookingIdByCode: Record<string, string>;
    /** Assistant text as the owner should see it (sanitizeReply). */
    clean?: (text: string) => string;
  },
): TranscriptItem[] {
  const at = new Map(rows.map((r) => [r.id, r.createdAt.toISOString()]));
  const items: TranscriptItem[] = [];
  for (const message of toChatMessages(rows)) {
    const when = at.get(message.id) ?? "";
    message.parts.forEach((part, index) => {
      const id = `${message.id}-${index}`;
      if (part.type === "text") {
        // A confirmation's sentence is shown by its row.
        const confirmation = message.parts.some((p) => p.type === "data-confirmation");
        if (part.text.trim() && !confirmation) {
          items.push({
            kind: "message",
            id,
            role: message.role as "user" | "assistant",
            text: message.role === "assistant" ? clean(part.text) : part.text,
            at: when,
          });
        }
        return;
      }
      if (part.type === "data-confirmation") {
        const data = obj(part.data);
        const card = obj(data.card);
        const code = str(card.code);
        const confirmedKind = { book: "Booked", reschedule: "Moved", cancel: "Cancelled" }[
          String(data.kind) as "book"
        ];
        items.push(
          data.confirmed
            ? {
                kind: "tool",
                id,
                label: `Customer confirmed · ${confirmedKind ?? "Done"}`,
                detail: [code, str(card.day), str(card.time)?.split(" – ")[0]]
                  .filter(Boolean)
                  .join(" · "),
                tone: "success",
                at: when,
                input: { proposalId: data.proposalId },
                output: data,
                bookingId: str(card.bookingId) ?? (code ? (bookingIdByCode[code] ?? null) : null),
                code,
              }
            : {
                kind: "tool",
                id,
                label: "Not confirmed",
                detail: data.error === "slot_taken" ? "that time was just taken" : str(data.error),
                tone: "warning",
                at: when,
                input: { proposalId: data.proposalId },
                output: data,
                bookingId: null,
                code: null,
              },
        );
        return;
      }
      if (part.type === "data-handoff") {
        items.push({
          kind: "tool",
          id,
          label: "Passed to the team",
          detail: "question, name and email sent",
          tone: "warning",
          at: when,
          input: null,
          output: part.data,
          bookingId: null,
          code: null,
        });
        return;
      }
      if (part.type.startsWith("tool-")) {
        const tool = part as unknown as { type: string; input?: unknown; output?: unknown };
        const name = tool.type.slice("tool-".length);
        items.push({
          kind: "tool",
          id,
          ...toolRow(name, obj(tool.input), obj(tool.output)),
          at: when,
          input: tool.input ?? null,
          output: tool.output ?? null,
          bookingId: null,
          code: null,
        });
      }
    });
  }
  return items;
}
