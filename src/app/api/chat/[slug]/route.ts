import {
  createUIMessageStreamResponse,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import { z } from "zod";

import { type ChatErrorBody, type ChatMessage, MAX_MESSAGE_CHARS, MAX_TURNS } from "@/lib/chat";
import { SLUG_PATTERN } from "@/lib/slug";
import { getChatModel } from "@/server/ai/model";
import { buildSystemPrompt } from "@/server/ai/prompt";
import {
  findConversation,
  getAiContext,
  loadTranscript,
  saveMessage,
  startConversation,
} from "@/server/db/queries/public/ai-chat";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { clientIp, rateLimit } from "@/server/rate-limit";

/*
 * POST /api/chat/<slug>  { conversationId?, text }
 *
 * The AI receptionist (steps 4.1–4.2: grounded answers, no tools yet). Public,
 * no login. Streams an AI SDK UI message stream; the first chunk's metadata
 * carries the conversation id for the next request. The transcript lives in
 * ai_conversations / ai_messages and is replayed to the model from there, so
 * the client never supplies history. 404 when the business is unknown or its
 * AI is off (or it isn't on Pro); 503 when no model is configured.
 *
 * Never logs prompts, messages or keys: errors are logged by name and message
 * with the business and conversation ids.
 */

const MAX_BODY_BYTES = 16 * 1024;

const body = z.object({
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1),
});

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (status: number, error: ChatErrorBody["error"], message: string, headers = {}) =>
  Response.json({ error, message } satisfies ChatErrorBody, {
    status,
    headers: { ...NO_STORE, ...headers },
  });

const notFound = () => refuse(404, "not_found", "Not found");

/** An error as safe log fields: never the request body, which holds the prompt. */
function describe(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
}

export async function POST(request: Request, { params }: RouteContext<"/api/chat/[slug]">) {
  const { slug } = await params;
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business?.aiEnabled) return notFound();
  const businessId = business.id;

  const limited = await rateLimit("chat", { ip: clientIp(request.headers), businessId });
  if (!limited.ok) {
    return refuse(429, "rate_limited", limited.message, {
      "Retry-After": String(limited.retryAfterSec),
    });
  }

  // Measured, not trusted from Content-Length (absent on chunked bodies).
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return refuse(413, "message_too_long", "That message is too long.");
  }
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not JSON: refused below.
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return refuse(400, "bad_request", "Type a message to send.");
  const { text } = parsed.data;
  if (text.length > MAX_MESSAGE_CHARS) {
    return refuse(
      400,
      "message_too_long",
      `Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`,
    );
  }

  const chat = getChatModel();
  if (!chat) {
    return refuse(
      503,
      "ai_unavailable",
      "The assistant isn't available right now. Please try later.",
    );
  }

  // An unknown id (or another business's) starts a new conversation: never append to it.
  const existing = parsed.data.conversationId
    ? await findConversation({ businessId, conversationId: parsed.data.conversationId })
    : null;
  if (existing && existing.userTurns >= MAX_TURNS) {
    return refuse(
      422,
      "conversation_limit",
      "This chat has reached its limit. Start a new chat to keep going.",
    );
  }

  const context = await getAiContext({ businessId });
  if (!context) return notFound();

  const conversationId = existing?.id ?? (await startConversation({ businessId, channel: "page" }));
  const history = existing ? await loadTranscript({ businessId, conversationId }) : [];
  await saveMessage({ businessId, conversationId, role: "user", content: text });

  const messages: ModelMessage[] = [...history, { role: "user", content: text }];
  const log = { businessId, conversationId, provider: chat.provider, model: chat.modelId };

  const result = streamText({
    model: chat.model,
    instructions: buildSystemPrompt(context, new Date()),
    messages,
    timeout: { totalMs: chat.timeoutMs },
    maxOutputTokens: 600,
    maxRetries: 1,
    onError: ({ error }) => console.error("[ai-chat] Model stream failed", log, describe(error)),
    onAbort: () => console.error("[ai-chat] Model timed out", log, `${chat.timeoutMs} ms`),
    onEnd: async ({ text: reply, totalUsage }) => {
      if (!reply.trim()) {
        console.warn("[ai-chat] Empty reply", log);
        return;
      }
      try {
        await saveMessage({
          businessId,
          conversationId,
          role: "assistant",
          content: reply,
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        });
      } catch (error) {
        console.error("[ai-chat] Saving the reply failed", log, describe(error));
      }
    },
  });
  // Run to the end (and save the reply) even if the customer closes the chat.
  void result.consumeStream();

  return createUIMessageStreamResponse({
    headers: NO_STORE,
    stream: toUIMessageStream<ToolSet, ChatMessage>({
      // A timeout arrives as an abort, which the chat would end silently: show it as an error.
      stream: result.stream.pipeThrough(
        new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
          transform(part, controller) {
            controller.enqueue(
              part.type === "abort" ? { type: "error", error: new Error("Timed out") } : part,
            );
          },
        }),
      ),
      sendReasoning: false,
      messageMetadata: ({ part }) => (part.type === "start" ? { conversationId } : undefined),
      onError: () => "Sorry, something went wrong on our side. Please try again.",
    }),
  });
}
