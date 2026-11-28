import { z } from "zod";

import { CHAT_OFF_MESSAGE, type ConfirmFailure, type ConfirmResponse } from "@/lib/chat";
import { SLUG_PATTERN } from "@/lib/slug";
import { confirmProposal } from "@/server/ai/confirm";
import { pgError } from "@/server/db/errors";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { refuseCrossSite } from "@/server/same-site";

/*
 * POST /api/chat/<slug>/confirm  { conversationId, proposalId, customer? }
 *
 * The customer tapped Confirm on the AI receptionist's card. The only door
 * from a proposal to the booking service (src/server/ai/confirm.ts). Public,
 * no login: the conversation id and proposal id (both random) are what tie the
 * tap to the chat that made the proposal. Rate-limited like booking from the
 * page.
 *
 * 200 confirmed (or already confirmed by an earlier tap) · 400 bad body ·
 * 404 unknown business / AI off / unknown proposal · 409 slot taken (with fresh
 * times) · 410 expired or used · 422 too late or no longer active · 429.
 */

const body = z.object({
  conversationId: z.uuid(),
  proposalId: z.uuid(),
  // A new booking's details from the card; validated in confirmProposal.
  customer: z
    .object({
      name: z.string().max(200),
      email: z.string().max(300),
      phone: z.string().max(100).optional(),
    })
    .optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };

const STATUS: Record<ConfirmFailure["error"], number> = {
  bad_request: 400,
  not_found: 404,
  slot_taken: 409,
  expired: 410,
  used: 410,
  too_late: 422,
  not_active: 422,
  rate_limited: 429,
};

const respond = (result: ConfirmResponse, headers: Record<string, string> = {}) =>
  Response.json(result, {
    status: result.ok ? 200 : STATUS[result.error],
    headers: { ...NO_STORE, ...headers },
  });

export async function POST(request: Request, { params }: RouteContext<"/api/chat/[slug]/confirm">) {
  // Only from the app's own pages (the widget's iframe is one).
  const crossSite = refuseCrossSite(request);
  if (crossSite) {
    return Response.json(
      { ok: false, error: "bad_request", message: crossSite.message } satisfies ConfirmResponse,
      { status: crossSite.status, headers: NO_STORE },
    );
  }
  const { slug } = await params;
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business) return respond({ ok: false, error: "not_found", message: "Not found" });
  // Switched off meanwhile: nothing more from the chat, and it says so.
  if (!business.aiEnabled) {
    return respond({ ok: false, error: "not_found", message: CHAT_OFF_MESSAGE });
  }
  const businessId = business.id;

  const limited = await rateLimit("book", { ip: clientIp(request.headers), businessId });
  if (!limited.ok) {
    return respond(
      { ok: false, error: "rate_limited", message: limited.message },
      { "Retry-After": String(limited.retryAfterSec) },
    );
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return respond({ ok: false, error: "bad_request", message: "Missing booking request." });
  }

  try {
    return respond(await confirmProposal({ businessId, slug, ...parsed.data }));
  } catch (error) {
    // Never the request or the customer's details: ids and the error only.
    console.error("[ai-confirm] Confirm failed", {
      businessId,
      proposalId: parsed.data.proposalId,
      sqlstate: pgError(error).code ?? null,
      // Name and the message's first line: never the query's parameters (customer details).
      error:
        error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "Unknown error",
    });
    return Response.json(
      { ok: false, error: "bad_request", message: "Something went wrong. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
