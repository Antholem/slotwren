import "server-only";

import type { OfferedTime, ProposalCard } from "@/lib/chat";
import { formatPrice } from "@/lib/money";
import { formatInZone } from "@/lib/dates";
import { nextDate, zonedInstant, zonedParts } from "@/lib/time-off";
import { gmtOffset } from "@/lib/timezones";
import { customerSchema } from "@/lib/validation/booking";
import { findPublicSlot, getPublicSlots } from "@/server/booking/public-slots";
import {
  createProposal,
  findBookingByCodeAndEmail,
  type Proposal,
  type VerifiedBooking,
} from "@/server/db/queries/public/ai-proposals";
import { getBookingPage } from "@/server/db/queries/public/booking-page";

import { whenLabel } from "./prompt";

/*
 * What the AI receptionist's tools do (src/server/ai/tools.ts wraps these for
 * the model). Read: listServices, checkAvailability, lookUpBooking. Propose:
 * proposeBooking, proposeReschedule, proposeCancel, which only store a
 * proposal for the Confirm card and never touch a booking.
 *
 * The scope (business, conversation, clock, timezones) comes from the route,
 * never from the model: a tool can't reach another business or conversation
 * whatever arguments it is given. Prices come from the database. Expected
 * refusals are returned as values the model can explain, never thrown.
 */

export type ReceptionistScope = {
  businessId: string;
  conversationId: string;
  /** The customer's IANA zone (the business's when unknown). */
  customerTimezone: string;
  now: Date;
};

export const PROPOSAL_TTL_MS = 10 * 60_000;
/** How many times one availability check hands the model. */
const MAX_TIMES = 12;
const MAX_ALTERNATIVES = 4;
/** Longest range one availability check reads. */
export const MAX_RANGE_DAYS = 14;

type Refusal = {
  status: "not_found" | "unavailable" | "invalid" | "too_late" | "not_active";
  message: string;
  alternatives?: OfferedTime[];
};

async function page(businessId: string) {
  const loaded = await getBookingPage(businessId);
  if (!loaded) throw new Error("Business has no booking page");
  return loaded;
}

type Page = Awaited<ReturnType<typeof page>>;

/** A bookable service by id or name (exact, then a unique partial match). */
function resolveService(p: Page, ref: string) {
  const key = ref.trim().toLowerCase();
  const exact = p.services.find((s) => s.id === ref.trim() || s.name.toLowerCase() === key);
  if (exact) return exact;
  const partial = p.services.filter((s) => s.name.toLowerCase().includes(key));
  return partial.length === 1 ? partial[0]! : null;
}

/** "any" (no preference), a person who does the service, or null when unknown. */
function resolveStaff(p: Page, serviceId: string, ref: string | undefined) {
  const key = ref?.trim().toLowerCase();
  if (!key || key === "any" || key === "anyone") return "any" as const;
  const candidates = p.staff.filter((s) => s.serviceIds.includes(serviceId));
  return (
    candidates.find((s) => s.id === ref!.trim() || s.name.toLowerCase() === key) ??
    candidates.find((s) => s.name.toLowerCase().split(/\s+/)[0] === key) ??
    null
  );
}

const staffName = (p: Page, id: string) => p.staff.find((s) => s.id === id)?.name ?? "Our team";

const priceLabel = (cents: number, currency: string) =>
  cents === 0 ? "Free" : formatPrice(cents, currency);

const notFoundService = (p: Page): Refusal => ({
  status: "not_found",
  message: `No bookable service by that name. Services: ${p.services.map((s) => s.name).join(", ")}.`,
});

// ── read ──────────────────────────────────────────────────────────────

export async function listServices(scope: ReceptionistScope) {
  const p = await page(scope.businessId);
  return {
    services: p.services.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      price: priceLabel(s.priceCents, p.business.currency),
      staff: p.staff
        .filter((person) => person.serviceIds.includes(s.id))
        .map((person) => ({ id: person.id, name: person.name })),
    })),
  };
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "any";

const inPartOfDay = (time: string, part: PartOfDay) => {
  const hour = Number(time.slice(0, 2));
  if (part === "morning") return hour < 12;
  if (part === "afternoon") return hour >= 12 && hour < 17;
  if (part === "evening") return hour >= 17;
  return true;
};

/** Free start times from `date` (business-local) for `days` days, in the customer's zone. */
async function freeTimes(
  scope: ReceptionistScope,
  p: Page,
  {
    serviceId,
    staffId,
    date,
    days,
    partOfDay = "any",
    excludeBookingId,
    limit,
  }: {
    serviceId: string;
    staffId: string | "any";
    date: string;
    days: number;
    partOfDay?: PartOfDay;
    excludeBookingId?: string;
    limit: number;
  },
): Promise<{ times: OfferedTime[]; more: number; next: OfferedTime | null } | null> {
  const zone = p.business.timezone;
  const slots = await getPublicSlots({
    businessId: scope.businessId,
    serviceId,
    staffId,
    from: zonedInstant(date, "00:00", zone),
    to: zonedInstant(nextDate(date, days), "00:00", zone),
    timezone: scope.customerTimezone,
    now: scope.now,
    excludeBookingId,
  });
  if (!slots) return null;
  const offer = (chip: { start: string; staffId: string | null }): OfferedTime => ({
    startsAt: chip.start,
    when: whenLabel(new Date(chip.start), scope.customerTimezone),
    day: formatInZone(new Date(chip.start), scope.customerTimezone, "EEE d MMM"),
    time: formatInZone(new Date(chip.start), scope.customerTimezone, "HH:mm"),
    staff: staffName(p, chip.staffId ?? ""),
  });
  const all = Object.keys(slots.days)
    .sort()
    .flatMap((day) => slots.days[day]!.available)
    .filter((chip) => inPartOfDay(chip.time, partOfDay));
  return {
    times: all.slice(0, limit).map(offer),
    more: Math.max(0, all.length - limit),
    next: all.length === 0 && slots.next ? offer(slots.next) : null,
  };
}

export async function checkAvailability(
  scope: ReceptionistScope,
  input: { service: string; staff?: string; date: string; days?: number; partOfDay?: PartOfDay },
) {
  const p = await page(scope.businessId);
  const service = resolveService(p, input.service);
  if (!service) return notFoundService(p);
  const staff = resolveStaff(p, service.id, input.staff);
  if (!staff) {
    return {
      status: "not_found",
      message: `Nobody by that name does ${service.name}. Ask for anyone, or one of: ${p.staff
        .filter((s) => s.serviceIds.includes(service.id))
        .map((s) => s.name)
        .join(", ")}.`,
    } satisfies Refusal;
  }
  const today = zonedParts(scope.now, p.business.timezone).date;
  const date = input.date < today ? today : input.date;
  const found = await freeTimes(scope, p, {
    serviceId: service.id,
    staffId: staff === "any" ? "any" : staff.id,
    date,
    // At most two weeks a check: bounded work per call, whatever the model asks.
    days: Math.min(Math.max(input.days ?? 1, 1), MAX_RANGE_DAYS),
    partOfDay: input.partOfDay,
    limit: MAX_TIMES,
  });
  if (!found) return notFoundService(p);
  return {
    status: "ok",
    service: { id: service.id, name: service.name, durationMin: service.durationMin },
    staff: staff === "any" ? "anyone" : staff.name,
    customerTimezone: scope.customerTimezone,
    times: found.times,
    moreTimes: found.more,
    /** When nothing is free in the range: the first opening after it. */
    nextOpening: found.next,
  } as const;
}

/** What a customer may see about their own booking. */
function describeBooking(b: VerifiedBooking, p: Page, scope: ReceptionistScope) {
  const hours = p.business.cancellationWindowHours;
  const deadline = new Date(b.startsAt.getTime() - hours * 3_600_000);
  const active = b.status === "pending" || b.status === "confirmed";
  return {
    code: b.code,
    service: b.serviceName,
    staff: b.staffName,
    when: whenLabel(b.startsAt, scope.customerTimezone),
    status: b.status,
    price: priceLabel(b.priceCents, p.business.currency),
    canChangeOnline: active && scope.now < deadline,
    changeDeadline: active ? whenLabel(deadline, scope.customerTimezone) : null,
  };
}

const NO_MATCH: Refusal = {
  status: "not_found",
  message:
    "No booking matches that code and email. Check both (the code is in the confirmation email), or ask the team.",
};

/**
 * The customer's own booking, if both the code and the email match. A wrong
 * code and a wrong email get the same answer, and nothing about any other
 * booking comes back.
 */
export async function lookUpBooking(
  scope: ReceptionistScope,
  input: { code: string; email: string },
) {
  const booking = await findBookingByCodeAndEmail({ businessId: scope.businessId, ...input });
  if (!booking) return NO_MATCH;
  return {
    status: "found",
    booking: describeBooking(booking, await page(scope.businessId), scope),
  };
}

// ── propose ───────────────────────────────────────────────────────────

function card(
  proposal: Proposal,
  p: Page,
  scope: ReceptionistScope,
  extra: { service: string; previousStart?: Date; code?: string },
): ProposalCard {
  return {
    proposalId: proposal.id,
    kind: proposal.kind,
    service: extra.service,
    staff: staffName(p, proposal.staffId),
    durationMin: Math.round((proposal.endsAt.getTime() - proposal.startsAt.getTime()) / 60_000),
    startsAt: proposal.startsAt.toISOString(),
    when: whenLabel(proposal.startsAt, scope.customerTimezone),
    day: formatInZone(proposal.startsAt, scope.customerTimezone, "EEE d MMM"),
    time: `${formatInZone(proposal.startsAt, scope.customerTimezone, "HH:mm")} – ${formatInZone(proposal.endsAt, scope.customerTimezone, "HH:mm")}`,
    zone: gmtOffset(scope.customerTimezone, proposal.startsAt),
    previousWhen: extra.previousStart
      ? whenLabel(extra.previousStart, scope.customerTimezone)
      : null,
    price: priceLabel(proposal.priceCents, p.business.currency),
    code: extra.code ?? null,
    customer: {
      name: proposal.customerName,
      email: proposal.customerEmail,
      // Only what the customer typed here: never a stored number for an existing booking.
      phone: proposal.kind === "book" ? proposal.customerPhone : null,
    },
    cancellationWindowHours: p.business.cancellationWindowHours,
    expiresAt: proposal.expiresAt.toISOString(),
  };
}

const proposed = (c: ProposalCard) => ({
  status: "proposed" as const,
  card: c,
  nextStep:
    c.kind === "book" && (!c.customer.name || !c.customer.email)
      ? "Nothing is booked yet. The customer sees a card with these details, adds their name and email there, and taps Confirm. Tell them to."
      : "Nothing has changed yet. The customer sees a card with these details; tell them to check it and tap Confirm.",
});

/** Fresh times near `startsAt` (that business-local day, else the next opening). */
async function alternativesNear(
  scope: ReceptionistScope,
  p: Page,
  serviceId: string,
  staffId: string | "any",
  startsAt: Date,
  excludeBookingId?: string,
): Promise<OfferedTime[]> {
  const found = await freeTimes(scope, p, {
    serviceId,
    staffId,
    date: zonedParts(startsAt, p.business.timezone).date,
    days: 1,
    excludeBookingId,
    limit: MAX_ALTERNATIVES,
  });
  if (!found) return [];
  return found.times.length ? found.times : found.next ? [found.next] : [];
}

/** Book: the exact slot, offered right now, with the price from the database. */
export async function proposeBooking(
  scope: ReceptionistScope,
  input: {
    service: string;
    staff?: string;
    startsAt: string;
    name?: string;
    email?: string;
    phone?: string;
  },
) {
  const p = await page(scope.businessId);
  const service = resolveService(p, input.service);
  if (!service) return notFoundService(p);
  const staff = resolveStaff(p, service.id, input.staff);
  if (!staff) return { status: "not_found", message: "Nobody by that name does this service." };
  // Whatever the customer already gave; the card asks for the rest.
  const customer = customerSchema.partial().safeParse({
    name: input.name || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
  });
  if (!customer.success) {
    return {
      status: "invalid",
      message: customer.error.issues[0]?.message ?? "Check the name and email.",
    } satisfies Refusal;
  }
  const startsAt = new Date(input.startsAt);
  const staffChoice = staff === "any" ? "any" : staff.id;
  const found = Number.isNaN(startsAt.getTime())
    ? null
    : await findPublicSlot({
        businessId: scope.businessId,
        serviceId: service.id,
        staffId: staffChoice,
        startsAt,
        now: scope.now,
      });
  if (!found) {
    return {
      status: "unavailable",
      message: "That time isn't available. Offer one of these instead, or check another day.",
      alternatives: Number.isNaN(startsAt.getTime())
        ? []
        : await alternativesNear(scope, p, service.id, staffChoice, startsAt),
    } satisfies Refusal;
  }
  const proposal = await createProposal({
    businessId: scope.businessId,
    values: {
      conversationId: scope.conversationId,
      kind: "book",
      serviceId: service.id,
      staffId: found.slot.staffId,
      anyStaff: staff === "any",
      startsAt: found.slot.start,
      endsAt: found.slot.end,
      priceCents: found.context.service.priceCents,
      customerName: customer.data.name ?? null,
      customerEmail: customer.data.email ?? null,
      customerPhone: customer.data.phone ?? null,
      customerTimezone: scope.customerTimezone,
      expiresAt: new Date(scope.now.getTime() + PROPOSAL_TTL_MS),
    },
  });
  return proposed(card(proposal, p, scope, { service: found.context.service.name }));
}

/** The verified, still-changeable booking, or why not. */
async function changeable(
  scope: ReceptionistScope,
  p: Page,
  input: { code: string; email: string },
): Promise<{ booking: VerifiedBooking } | Refusal> {
  const booking = await findBookingByCodeAndEmail({ businessId: scope.businessId, ...input });
  if (!booking) return NO_MATCH;
  const view = describeBooking(booking, p, scope);
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return {
      status: "not_active",
      message: `This booking is ${booking.status.replace("_", "-")}.`,
    };
  }
  if (!view.canChangeOnline) {
    const hours = p.business.cancellationWindowHours;
    return {
      status: "too_late",
      message: `Online changes close ${hours} ${hours === 1 ? "hour" : "hours"} before the appointment. The customer needs to contact the team.`,
    };
  }
  return { booking };
}

export async function proposeReschedule(
  scope: ReceptionistScope,
  input: { code: string; email: string; startsAt: string; staff?: string },
) {
  const p = await page(scope.businessId);
  const checked = await changeable(scope, p, input);
  if ("status" in checked) return checked;
  const { booking } = checked;
  // Default: the same person, as on the manage page.
  const staff = input.staff ? resolveStaff(p, booking.serviceId, input.staff) : booking.staffId;
  if (!staff) return { status: "not_found", message: "Nobody by that name does this service." };
  const staffChoice = typeof staff === "string" ? staff : staff.id;
  const startsAt = new Date(input.startsAt);
  const found = Number.isNaN(startsAt.getTime())
    ? null
    : await findPublicSlot({
        businessId: scope.businessId,
        serviceId: booking.serviceId,
        staffId: staffChoice,
        startsAt,
        now: scope.now,
        excludeBookingId: booking.id,
      });
  if (!found) {
    return {
      status: "unavailable",
      message: "That time isn't available. Offer one of these instead, or check another day.",
      alternatives: Number.isNaN(startsAt.getTime())
        ? []
        : await alternativesNear(scope, p, booking.serviceId, staffChoice, startsAt, booking.id),
    } satisfies Refusal;
  }
  const proposal = await createProposal({
    businessId: scope.businessId,
    values: {
      conversationId: scope.conversationId,
      kind: "reschedule",
      bookingId: booking.id,
      serviceId: booking.serviceId,
      staffId: found.slot.staffId,
      anyStaff: staffChoice === "any",
      startsAt: found.slot.start,
      endsAt: found.slot.end,
      // A reschedule keeps the price the customer booked at.
      priceCents: booking.priceCents,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      customerTimezone: scope.customerTimezone,
      expiresAt: new Date(scope.now.getTime() + PROPOSAL_TTL_MS),
    },
  });
  return proposed(
    card(proposal, p, scope, {
      service: booking.serviceName,
      previousStart: booking.startsAt,
      code: booking.code,
    }),
  );
}

export async function proposeCancel(
  scope: ReceptionistScope,
  input: { code: string; email: string },
) {
  const p = await page(scope.businessId);
  const checked = await changeable(scope, p, input);
  if ("status" in checked) return checked;
  const { booking } = checked;
  const proposal = await createProposal({
    businessId: scope.businessId,
    values: {
      conversationId: scope.conversationId,
      kind: "cancel",
      bookingId: booking.id,
      serviceId: booking.serviceId,
      staffId: booking.staffId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      priceCents: booking.priceCents,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      customerTimezone: scope.customerTimezone,
      expiresAt: new Date(scope.now.getTime() + PROPOSAL_TTL_MS),
    },
  });
  return proposed(card(proposal, p, scope, { service: booking.serviceName, code: booking.code }));
}

/**
 * The receptionist isn't sure: the chat shows a "Message the team" form,
 * prefilled with the question. Saves nothing; the customer sends the form.
 */
export function offerHandoff(input: { question: string }) {
  return {
    status: "handoff" as const,
    question: input.question,
    nextStep: "The customer sees a form to send this question to the team, who reply by email.",
  };
}

export { alternativesNear, page as receptionistPage };
