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

export type ChatRequest = { conversationId?: string; text: string };

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
