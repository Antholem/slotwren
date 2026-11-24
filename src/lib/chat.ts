import type { UIMessage } from "ai";

/*
 * The AI receptionist's wire contract, shared by /api/chat/[slug] and the chat
 * UI. The client sends one message and the conversation id it was given; the
 * server keeps the transcript (and replays it to the model), so a client can't
 * rewrite earlier turns.
 */

/** Longest customer message, in characters. */
export const MAX_MESSAGE_CHARS = 1000;

/** Customer messages per conversation; after that, a new chat. */
export const MAX_TURNS = 20;

/** `timezone`: the customer's IANA zone, so offered times show in their clock. */
export type ChatRequest = { conversationId?: string; text: string; timezone?: string };

/** Sent with the first chunk of every reply: the id to send back next time. */
export type ChatMetadata = { conversationId: string };

export type ChatMessage = UIMessage<ChatMetadata>;

/** The `{ error, message }` body of a refused request. */
export type ChatErrorBody = {
  error:
    | "not_found"
    | "bad_request"
    | "message_too_long"
    | "conversation_limit"
    | "rate_limited"
    | "ai_unavailable";
  message: string;
};

/** A time the receptionist offers: an exact start and how the customer reads it. */
export type OfferedTime = {
  /** ISO instant: what proposeBooking / proposeReschedule take. */
  startsAt: string;
  /** In the customer's timezone: "Sat 28 Nov, 10:00 (GMT+8)". */
  when: string;
  staff: string;
};

/**
 * What a Confirm card shows (the propose* tools' output). Nothing is booked,
 * moved or cancelled until the customer taps Confirm, which posts
 * `proposalId` to /api/chat/[slug]/confirm.
 */
export type ProposalCard = {
  proposalId: string;
  kind: "book" | "reschedule" | "cancel";
  service: string;
  staff: string;
  durationMin: number;
  /** ISO instant of the (new) start. */
  startsAt: string;
  when: string;
  /** Reschedule: the time it moves from. */
  previousWhen: string | null;
  /** "$35.00", or "Free". */
  price: string;
  /** Cancel: the booking's code. */
  code: string | null;
  customer: { name: string; email: string; phone: string | null };
  /** ISO instant; after it, Confirm refuses and the customer asks again. */
  expiresAt: string;
};

/** POST /api/chat/[slug]/confirm */
export type ConfirmRequest = { conversationId: string; proposalId: string };

export type ConfirmSuccess = {
  ok: true;
  kind: ProposalCard["kind"];
  bookingId: string;
  code: string;
  /** The booking's manage link token, once (absent when a double tap already confirmed it). */
  manageToken: string | null;
  /** What the chat shows, and what the receptionist reads next turn. */
  message: string;
};

export type ConfirmFailure = {
  ok: false;
  error:
    | "not_found"
    | "bad_request"
    | "expired"
    | "used"
    | "slot_taken"
    | "too_late"
    | "not_active"
    | "rate_limited";
  message: string;
  /** slot_taken: fresh times to choose from instead. */
  alternatives?: OfferedTime[];
};

export type ConfirmResponse = ConfirmSuccess | ConfirmFailure;
