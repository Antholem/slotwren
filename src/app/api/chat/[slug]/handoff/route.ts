import { z } from "zod";

import { CHAT_OFF_MESSAGE, type HandoffResponse, MAX_OPEN_QUESTIONS } from "@/lib/chat";
import { SLUG_PATTERN } from "@/lib/slug";
import { customerSchema } from "@/lib/validation/booking";
import {
  findConversation,
  saveHandoff,
  saveMessage,
  startConversation,
} from "@/server/db/queries/public/ai-chat";
import { openQuestionsFor, recordGuardrailEvent } from "@/server/db/queries/public/ai-guardrails";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { clientIp, limitAll, rateLimit } from "@/server/rate-limit";

/*
 * POST /api/chat/<slug>/handoff  { conversationId?, name, email, message, website? }
 *
 * "Message the team" from the AI receptionist: saved as an open question on
 * the customer's profile, answered by a person by email. Public, no login.
 * Works without a conversation too (the chat may be resting for the month):
 * then it starts one. Guardrails against spam (step 4.6):
 * - `website` is a honeypot: people never see it; a filled one is answered
 *   as if sent and saved nowhere.
 * - 3 an hour per IP, 3 a day per email per business.
 * - at most 3 open questions per customer (by email).
 * - an existing customer's name and phone are never changed (saveHandoff).
 */

const NO_STORE = { "Cache-Control": "no-store" };

const HANDOFF_SENT = "Thanks, I've passed your question to the team. Someone will reply by email.";

const body = z.object({
  conversationId: z.uuid().optional(),
  name: customerSchema.shape.name,
  email: customerSchema.shape.email,
  message: z
    .string()
    .trim()
    .min(1, "Type your question.")
    .max(1000, "Keep your question under 1,000 characters."),
  website: z.string().max(500).optional(),
});

const respond = (result: HandoffResponse, status = result.ok ? 200 : 400, headers = {}) =>
  Response.json(result, { status, headers: { ...NO_STORE, ...headers } });

export async function POST(request: Request, { params }: RouteContext<"/api/chat/[slug]/handoff">) {
  const { slug } = await params;
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business) return respond({ ok: false, error: "not_found", message: "Not found" }, 404);
  if (!business.aiEnabled) {
    return respond({ ok: false, error: "not_found", message: CHAT_OFF_MESSAGE }, 404);
  }
  const businessId = business.id;
  const ip = clientIp(request.headers);

  const limited = await rateLimit("book", { ip, businessId });
  if (!limited.ok) {
    return respond({ ok: false, error: "rate_limited", message: limited.message }, 429, {
      "Retry-After": String(limited.retryAfterSec),
    });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return respond({
      ok: false,
      error: "bad_request",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    });
  }
  const { name, email, message, website } = parsed.data;

  // A bot filled the field people can't see: look sent, keep nothing.
  if (website?.trim()) {
    await recordGuardrailEvent({ businessId, kind: "honeypot" });
    return respond({ ok: true, message: HANDOFF_SENT, conversationId: null });
  }

  const spam = await limitAll([
    ["handoff:ip", ip],
    ["handoff:email", `${businessId}:${email.toLowerCase()}`],
  ]);
  if (!spam.ok) {
    await recordGuardrailEvent({
      businessId,
      kind: "handoff_limited",
      detail: { limit: spam.limit },
    });
    return respond({ ok: false, error: "rate_limited", message: spam.message }, 429, {
      "Retry-After": String(spam.retryAfterSec),
    });
  }
  if ((await openQuestionsFor({ businessId, email })) >= MAX_OPEN_QUESTIONS) {
    await recordGuardrailEvent({ businessId, kind: "handoff_limited", detail: { limit: "open" } });
    return respond(
      {
        ok: false,
        error: "rate_limited",
        message: `You already have ${MAX_OPEN_QUESTIONS} questions waiting for the team. They'll reply by email.`,
      },
      429,
    );
  }

  const existing = parsed.data.conversationId
    ? await findConversation({ businessId, conversationId: parsed.data.conversationId })
    : null;
  if (parsed.data.conversationId && !existing) {
    return respond({ ok: false, error: "not_found", message: "Start a chat first." }, 404);
  }
  const conversationId = existing?.id ?? (await startConversation({ businessId, channel: "page" }));

  await saveHandoff({ businessId, conversationId, name, email, message });
  // In the transcript, so a refresh shows it sent and the model knows next turn.
  await saveMessage({
    businessId,
    conversationId,
    role: "assistant",
    content: HANDOFF_SENT,
    parts: [
      { type: "text", text: HANDOFF_SENT },
      { type: "data-handoff", data: { sent: true } },
    ],
  });
  return respond({ ok: true, message: HANDOFF_SENT, conversationId });
}
