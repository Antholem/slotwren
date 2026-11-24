import "server-only";

import type { ConfirmedCard, ConfirmRequest, ConfirmResponse } from "@/lib/chat";
import { googleCalendarUrl } from "@/lib/calendar";
import { formatInZone } from "@/lib/dates";
import { customerSchema } from "@/lib/validation/booking";
import { loadConfirmation } from "@/server/booking/confirmation";
import {
  type BookingError,
  cancelBooking,
  createBooking,
  rescheduleBooking,
} from "@/server/booking/service";
import { saveMessage } from "@/server/db/queries/public/ai-chat";
import {
  bookingCode,
  claimProposal,
  findProposal,
  type Proposal,
  setConversationOutcome,
  settleProposal,
} from "@/server/db/queries/public/ai-proposals";

import { whenLabel } from "./prompt";
import { alternativesNear, receptionistPage } from "./receptionist";

/*
 * The customer tapped Confirm on a proposal card: the only way anything the AI
 * receptionist proposed becomes a booking change (CLAUDE.md, rule 7).
 *
 * - The proposal must belong to this business and this conversation, be
 *   unexpired and not used. Claiming it is one UPDATE … WHERE state = 'open',
 *   so of two taps exactly one goes ahead; the other waits for that one's
 *   result and returns the same booking (a double tap books once).
 * - The booking service re-checks everything (slot, notice, cancellation
 *   window, status) with source "ai"; the exclusion constraint decides races,
 *   and "just taken" comes back with fresh times.
 * - A new booking's card collects the name and email the chat didn't get;
 *   they're validated here like the booking page's details step.
 * - The outcome goes into the transcript, so the receptionist knows next turn
 *   and the chat can show the booked card again after a refresh.
 */

const WAIT_FOR_OTHER_TAP_MS = 8_000;

type Failure = Extract<ConfirmResponse, { ok: false }>;

const fail = (error: Failure["error"], message: string, extra: Partial<Failure> = {}): Failure => ({
  ok: false,
  error,
  message,
  ...extra,
});

const MESSAGES = {
  notFound: "We couldn't find that booking request. Ask the assistant again.",
  expired: "This request has expired. Ask the assistant for the time again.",
  used: "This request was already used. Ask the assistant if you'd like to change anything.",
  busy: "We're still confirming this one. Give it a moment, then check the chat.",
  details: "Add your name and email to book.",
  taken: "That time was just taken. Here are other times you can pick instead.",
  takenNoAlternatives: "That time was just taken, and nothing else is free that day.",
} as const;

async function waitForSettled(businessId: string, proposalId: string): Promise<Proposal | null> {
  const until = Date.now() + WAIT_FOR_OTHER_TAP_MS;
  for (;;) {
    const proposal = await findProposal({ businessId, proposalId });
    if (!proposal || proposal.state !== "confirming" || Date.now() > until) return proposal;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Why a proposal couldn't be claimed, or the earlier tap's result. */
async function unclaimed(
  businessId: string,
  conversationId: string,
  proposalId: string,
  now: Date,
): Promise<ConfirmResponse> {
  let proposal = await findProposal({ businessId, proposalId });
  // Another conversation's proposal is as good as no proposal.
  if (!proposal || proposal.conversationId !== conversationId) {
    return fail("not_found", MESSAGES.notFound);
  }
  // A second tap while the first is still going: wait, and answer with its
  // booking. Once settled, a proposal is spent: later taps are refused.
  if (proposal.state === "confirming") {
    const settled = (await waitForSettled(businessId, proposalId)) ?? proposal;
    if (settled.state === "confirmed" && settled.bookingId) {
      return {
        ok: true,
        kind: settled.kind,
        bookingId: settled.bookingId,
        code: (await bookingCode({ businessId, bookingId: settled.bookingId })) ?? "",
        manageToken: null,
        message: "Already confirmed.",
        card: null,
      };
    }
    if (settled.state === "confirming") return fail("used", MESSAGES.busy);
    proposal = settled;
  }
  if (proposal.state === "open" && proposal.expiresAt <= now) {
    return fail("expired", MESSAGES.expired);
  }
  return fail("used", MESSAGES.used);
}

type Customer = { name: string; email: string; phone: string | null };

/** Run the proposal through the booking service. */
async function apply(proposal: Proposal, customer: Customer | null, now: Date) {
  const { businessId } = proposal;
  if (proposal.kind === "book") {
    const result = await createBooking(
      { kind: "public", businessId, source: "ai", aiConversationId: proposal.conversationId },
      {
        serviceId: proposal.serviceId,
        staffId: proposal.staffId,
        startsAt: proposal.startsAt,
        customer,
        notes: null,
        customerTimezone: proposal.customerTimezone ?? undefined,
      },
      { now },
    );
    return result.ok
      ? ({
          ok: true,
          bookingId: result.data.id,
          code: result.data.code,
          manageToken: result.data.manageToken,
        } as const)
      : result;
  }
  const access = { kind: "chat", businessId, bookingId: proposal.bookingId! } as const;
  if (proposal.kind === "reschedule") {
    const result = await rescheduleBooking(
      access,
      { startsAt: proposal.startsAt, staffId: proposal.staffId },
      { now },
    );
    return result.ok
      ? ({
          ok: true,
          bookingId: result.data.id,
          code: (await bookingCode({ businessId, bookingId: result.data.id })) ?? "",
          manageToken: result.data.manageToken,
        } as const)
      : result;
  }
  const result = await cancelBooking(access, {}, { now });
  return result.ok
    ? ({ ok: true, bookingId: result.data.id, code: result.data.code, manageToken: null } as const)
    : result;
}

const FAILURE_FOR: Record<BookingError, Failure["error"]> = {
  slot_taken: "slot_taken",
  slot_unavailable: "slot_taken",
  too_late: "too_late",
  not_active: "not_active",
  not_found: "not_found",
  forbidden: "not_found",
  invalid_input: "bad_request",
  too_early: "bad_request",
};

/** The booked card: what, when, the code, and add-to-calendar links. */
async function confirmedCard(
  slug: string,
  proposal: Proposal,
  outcome: { bookingId: string; code: string },
  names: { service: string; staff: string },
  email: string | null,
  zone: string,
  windowHours: number,
): Promise<ConfirmedCard> {
  const calendar =
    proposal.kind === "cancel" ? null : await loadConfirmation(slug, outcome.bookingId);
  const freeUntil = new Date(proposal.startsAt.getTime() - windowHours * 3_600_000);
  return {
    kind: proposal.kind,
    bookingId: outcome.bookingId,
    code: outcome.code,
    ...names,
    day: formatInZone(proposal.startsAt, zone, "EEE d MMM"),
    time: `${formatInZone(proposal.startsAt, zone, "HH:mm")} – ${formatInZone(proposal.endsAt, zone, "HH:mm")}`,
    email,
    freeUntil: windowHours > 0 && proposal.kind !== "cancel" ? whenLabel(freeUntil, zone) : null,
    googleCalendarUrl: calendar ? googleCalendarUrl(calendar.event) : null,
    icsPath: calendar ? `/b/${slug}/booked/${outcome.bookingId}/event.ics` : null,
  };
}

export async function confirmProposal({
  businessId,
  slug,
  conversationId,
  proposalId,
  customer: typed,
  now = new Date(),
}: {
  businessId: string;
  /** The booking page the chat is on: the calendar links point at it. */
  slug: string;
  conversationId: string;
  proposalId: string;
  customer?: ConfirmRequest["customer"];
  now?: Date;
}): Promise<ConfirmResponse> {
  // The card's details, checked before the proposal is claimed.
  const card = typed ? customerSchema.safeParse(typed) : null;
  if (card && !card.success) {
    return fail("bad_request", card.error.issues[0]?.message ?? MESSAGES.details);
  }
  const proposal = await claimProposal({ businessId, conversationId, proposalId, now });
  if (!proposal) return unclaimed(businessId, conversationId, proposalId, now);

  let customer: Customer | null = null;
  if (proposal.kind === "book") {
    const name = card?.data.name ?? proposal.customerName;
    const email = card?.data.email ?? proposal.customerEmail;
    if (!name || !email) {
      await settleProposal({ businessId, proposalId, state: "open", now });
      return fail("bad_request", MESSAGES.details);
    }
    customer = { name, email, phone: card ? card.data.phone : proposal.customerPhone };
  }

  let outcome: Awaited<ReturnType<typeof apply>>;
  try {
    outcome = await apply(proposal, customer, now);
  } catch (error) {
    // Unexpected (the database went away): hand the proposal back for a retry.
    await settleProposal({ businessId, proposalId, state: "open", now });
    throw error;
  }

  const page = await receptionistPage(businessId);
  const zone = proposal.customerTimezone ?? page.business.timezone;
  const service = page.services.find((s) => s.id === proposal.serviceId)?.name ?? "Appointment";
  const staff = page.staff.find((s) => s.id === proposal.staffId)?.name ?? "our team";
  const when = whenLabel(proposal.startsAt, zone);

  if (outcome.ok) {
    await settleProposal({
      businessId,
      proposalId,
      state: "confirmed",
      bookingId: outcome.bookingId,
      customer: customer ?? undefined,
      now,
    });
    const message =
      proposal.kind === "book"
        ? `Booked: ${service} with ${staff}, ${when}. Booking code ${outcome.code}. A confirmation email is on its way.`
        : proposal.kind === "reschedule"
          ? `Moved: ${service} with ${staff} is now ${when}. Booking code ${outcome.code}. An email with the new time is on its way.`
          : `Cancelled: ${service} on ${when} (booking ${outcome.code}). A cancellation email is on its way.`;
    if (proposal.kind === "book") {
      await setConversationOutcome({ businessId, conversationId, outcome: "booked" });
    }
    const booked = await confirmedCard(
      slug,
      proposal,
      outcome,
      { service, staff },
      customer?.email ?? proposal.customerEmail,
      zone,
      page.business.cancellationWindowHours,
    );
    await record(proposal, message, { confirmed: true, card: booked });
    return {
      ok: true,
      kind: proposal.kind,
      bookingId: outcome.bookingId,
      code: outcome.code,
      manageToken: outcome.manageToken,
      message,
      card: booked,
    };
  }

  await settleProposal({ businessId, proposalId, state: "failed", now });
  const error = FAILURE_FOR[outcome.error.code];
  if (error !== "slot_taken") {
    await record(proposal, `Not confirmed: ${outcome.error.message}`, { confirmed: false, error });
    return fail(error, outcome.error.message);
  }

  // Lost the race (or the time went meanwhile): offer fresh times near it.
  const alternatives = await alternativesNear(
    { businessId, conversationId, customerTimezone: zone, now },
    page,
    proposal.serviceId,
    proposal.anyStaff ? "any" : proposal.staffId,
    proposal.startsAt,
    proposal.kind === "reschedule" ? (proposal.bookingId ?? undefined) : undefined,
  );
  const message = alternatives.length ? MESSAGES.taken : MESSAGES.takenNoAlternatives;
  await record(
    proposal,
    `${message}${alternatives.length ? ` ${alternatives.map((a) => a.when).join("; ")}.` : ""}`,
    { confirmed: false, error, alternatives },
  );
  return fail("slot_taken", message, { alternatives });
}

/** The outcome as an assistant turn: the chat shows it and the model reads it next time. */
async function record(proposal: Proposal, content: string, data: Record<string, unknown>) {
  await saveMessage({
    businessId: proposal.businessId,
    conversationId: proposal.conversationId,
    role: "assistant",
    content,
    parts: [
      { type: "text", text: content },
      {
        type: "data-confirmation",
        data: { proposalId: proposal.id, kind: proposal.kind, ...data },
      },
    ],
  });
}
