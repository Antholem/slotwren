import type { UIMessage } from "ai";

/*
 * The AI receptionist's wire contract, shared by /api/chat/[slug] (and its
 * confirm and handoff routes) and the chat UI. The client sends one message
 * and the conversation id it was given; the server keeps the transcript (and
 * replays it to the model), so a client can't rewrite earlier turns.
 */

/** Longest customer message, in characters. */
export const MAX_MESSAGE_CHARS = 1000;

/** Customer messages per conversation; after that, a new chat. */
export const MAX_TURNS = 20;

/** `timezone`: the customer's IANA zone, so offered times show in their clock. */
export type ChatRequest = { conversationId?: string; text: string; timezone?: string };

/** Sent with the first chunk of every reply: the id to send back next time. */
export type ChatMetadata = { conversationId: string };

/** What the chat says when the business has switched its receptionist off. */
export const CHAT_OFF_MESSAGE =
  "The chat is unavailable right now. You can still book on this page.";

/** The `{ error, message }` body of a refused request. */
export type ChatErrorBody = {
  error:
    | "not_found"
    | "bad_request"
    | "message_too_long"
    | "conversation_limit"
    | "rate_limited"
    | "ai_unavailable"
    | "ai_resting";
  message: string;
};

/** A time the receptionist offers: an exact start and how the customer reads it. */
export type OfferedTime = {
  /** ISO instant: what proposeBooking / proposeReschedule take. */
  startsAt: string;
  /** In the customer's timezone: "Sat 28 Nov, 10:00 (GMT+8)". */
  when: string;
  /** "Sat 28 Nov" and "10:00", for chips. */
  day: string;
  time: string;
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
  /** "Sat 28 Nov", "10:00 – 10:45" and "GMT+8", in the customer's timezone. */
  day: string;
  time: string;
  zone: string;
  /** Reschedule: the time it moves from. */
  previousWhen: string | null;
  /** "$35", or "Free". */
  price: string;
  /** Reschedule and cancel: the booking's code. */
  code: string | null;
  /**
   * What the chat already knows. A new booking's card lets the customer fill
   * in or fix these before Confirm; a change shows the booking's own.
   */
  customer: { name: string | null; email: string | null; phone: string | null };
  /** "Free cancellation up to 24 h before" (0: any time before it starts). */
  cancellationWindowHours: number;
  /** ISO instant; after it, Confirm refuses and the customer asks again. */
  expiresAt: string;
};

/** POST /api/chat/[slug]/confirm. `customer`: a new booking's details from the card. */
export type ConfirmRequest = {
  conversationId: string;
  proposalId: string;
  customer?: { name: string; email: string; phone?: string };
};

/** The booked (moved, cancelled) card, live after Confirm and from history after a refresh. */
export type ConfirmedCard = {
  kind: ProposalCard["kind"];
  bookingId: string;
  code: string;
  service: string;
  staff: string;
  day: string;
  time: string;
  /** Where the confirmation went. */
  email: string | null;
  /** "Fri 27 Nov, 10:00 (GMT+8)", or null when changes are free until it starts. */
  freeUntil: string | null;
  /** Add to calendar (not for a cancellation). */
  googleCalendarUrl: string | null;
  icsPath: string | null;
};

export type ConfirmSuccess = {
  ok: true;
  kind: ProposalCard["kind"];
  bookingId: string;
  code: string;
  /** The booking's manage link token, once (absent when a double tap already confirmed it). */
  manageToken: string | null;
  /** What the chat shows, and what the receptionist reads next turn. */
  message: string;
  card: ConfirmedCard | null;
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

/** Questions one customer (email) may have waiting for the team at once. */
export const MAX_OPEN_QUESTIONS = 3;

/**
 * POST /api/chat/[slug]/handoff: a question for the team, answered by email.
 * No `conversationId` (the chat is resting): the route starts one. `website`
 * is a honeypot people never see.
 */
export type HandoffRequest = {
  conversationId?: string;
  name: string;
  email: string;
  message: string;
  website?: string;
};

export type HandoffResponse =
  | { ok: true; message: string; conversationId: string | null }
  | { ok: false; error: "not_found" | "bad_request" | "rate_limited"; message: string };

/** Data parts stored with confirmations and hand-offs, shown again after a refresh. */
export type ChatDataParts = {
  confirmation: {
    proposalId: string;
    kind: ProposalCard["kind"];
    confirmed: boolean;
    card?: ConfirmedCard | null;
    error?: ConfirmFailure["error"];
    alternatives?: OfferedTime[];
  };
  handoff: { sent: true };
};

export type ChatMessage = UIMessage<ChatMetadata, ChatDataParts>;

/** GET /api/chat/[slug]?conversationId=…: the conversation so far, for a refresh. */
export type ChatHistory = { conversationId: string; messages: ChatMessage[] };
