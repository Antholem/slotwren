import { z } from "zod";

import type { HandoffResponse } from "@/lib/chat";
import { SLUG_PATTERN } from "@/lib/slug";
import { customerSchema } from "@/lib/validation/booking";
import { findConversation, saveHandoff, saveMessage } from "@/server/db/queries/public/ai-chat";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { clientIp, rateLimit } from "@/server/rate-limit";

/*
 * POST /api/chat/<slug>/handoff  { conversationId, name, email, message }
 *
 * "Message the team" from the AI receptionist: saved as an open question on
 * the customer's profile, answered by a person by email. Public, no login;
 * the conversation must be this business's. Rate-limited like a booking.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const HANDOFF_SENT = "Thanks, I've passed your question to the team. Someone will reply by email.";

const body = z.object({
  conversationId: z.uuid(),
  name: customerSchema.shape.name,
  email: customerSchema.shape.email,
  message: z
    .string()
    .trim()
    .min(1, "Type your question.")
    .max(1000, "Keep your question under 1,000 characters."),
});

const respond = (result: HandoffResponse, status = result.ok ? 200 : 400) =>
  Response.json(result, { status, headers: NO_STORE });

export async function POST(request: Request, { params }: RouteContext<"/api/chat/[slug]/handoff">) {
  const { slug } = await params;
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business?.aiEnabled) {
    return respond({ ok: false, error: "not_found", message: "Not found" }, 404);
  }
  const businessId = business.id;

  const limited = await rateLimit("book", { ip: clientIp(request.headers), businessId });
  if (!limited.ok) {
    return Response.json(
      { ok: false, error: "rate_limited", message: limited.message } satisfies HandoffResponse,
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return respond({
      ok: false,
      error: "bad_request",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    });
  }
  const { conversationId, name, email, message } = parsed.data;
  const conversation = await findConversation({ businessId, conversationId });
  if (!conversation) {
    return respond({ ok: false, error: "not_found", message: "Start a chat first." }, 404);
  }

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
  return respond({ ok: true, message: HANDOFF_SENT });
}
