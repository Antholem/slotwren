import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";

import { adminQuery, type TenantScoped } from "../../admin";
import { aiConversations, aiProposals, bookings, customers, services, staff } from "../../schema";

/*
 * The AI receptionist's tools and Confirm (src/server/ai/): finding a
 * customer's own booking by code + email, and the proposals the Confirm card
 * shows. No signed-in user, so adminDb, always by businessId. Proposals are
 * server-only (RLS on, no policies); nothing here creates or changes a
 * booking — that's src/server/booking/service.ts, after Confirm.
 */

/**
 * A booking the customer proved is theirs: both the code and the email match,
 * in this business. Used by the tools and by Confirm; the tools pass on only
 * what the customer may see about their own booking.
 */
export type VerifiedBooking = {
  id: string;
  code: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  startsAt: Date;
  endsAt: Date;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  priceCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerTimezone: string | null;
};

/** Codes look like "SW-8K3D-27"; matched without case or surrounding space. */
export const normaliseCode = (code: string) => code.trim().toUpperCase();

export const findBookingByCodeAndEmail = adminQuery(
  async (
    db,
    { businessId, code, email }: TenantScoped & { code: string; email: string },
  ): Promise<VerifiedBooking | null> => {
    const [row] = await db
      .select({
        id: bookings.id,
        code: bookings.code,
        status: bookings.status,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        serviceId: bookings.serviceId,
        serviceName: services.name,
        staffId: bookings.staffId,
        staffName: staff.name,
        priceCents: bookings.priceCents,
        customerName: bookings.customerName,
        customerEmail: customers.email,
        customerPhone: bookings.customerPhone,
        customerTimezone: bookings.customerTimezone,
      })
      .from(bookings)
      .innerJoin(
        customers,
        and(eq(customers.id, bookings.customerId), eq(customers.businessId, businessId)),
      )
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.businessId, businessId)),
      )
      .innerJoin(staff, and(eq(staff.id, bookings.staffId), eq(staff.businessId, businessId)))
      .where(
        and(
          eq(bookings.businessId, businessId),
          eq(bookings.code, normaliseCode(code)),
          sql`lower(${customers.email}) = lower(${email.trim()})`,
        ),
      )
      .limit(1);
    return row ?? null;
  },
);

export type Proposal = typeof aiProposals.$inferSelect;
export type NewProposal = Omit<
  typeof aiProposals.$inferInsert,
  "id" | "businessId" | "state" | "settledAt" | "createdAt"
>;

export const createProposal = adminQuery(
  async (db, { businessId, values }: TenantScoped & { values: NewProposal }): Promise<Proposal> => {
    const [row] = await db
      .insert(aiProposals)
      .values({ ...values, businessId })
      .returning();
    return row!;
  },
);

/** A proposal of this business, whatever its state. */
export const findProposal = adminQuery(
  async (db, { businessId, proposalId }: TenantScoped & { proposalId: string }) => {
    const [row] = await db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.businessId, businessId)));
    return row ?? null;
  },
);

/**
 * Take an open, unexpired proposal of this conversation for confirming, once:
 * of two taps at the same moment exactly one gets it. Null otherwise.
 */
export const claimProposal = adminQuery(
  async (
    db,
    {
      businessId,
      conversationId,
      proposalId,
      now,
    }: TenantScoped & { conversationId: string; proposalId: string; now: Date },
  ): Promise<Proposal | null> => {
    const [row] = await db
      .update(aiProposals)
      .set({ state: "confirming" })
      .where(
        and(
          eq(aiProposals.id, proposalId),
          eq(aiProposals.businessId, businessId),
          eq(aiProposals.conversationId, conversationId),
          eq(aiProposals.state, "open"),
          gt(aiProposals.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  },
);

/** Record how a claimed proposal ended; `open` hands it back after an unexpected error. */
export const settleProposal = adminQuery(
  async (
    db,
    {
      businessId,
      proposalId,
      state,
      bookingId,
      customer,
      now,
    }: TenantScoped & {
      proposalId: string;
      state: "open" | "confirmed" | "failed";
      bookingId?: string;
      /** A new booking: the details it was confirmed with (from the card). */
      customer?: { name: string; email: string; phone: string | null };
      now: Date;
    },
  ): Promise<void> => {
    await db
      .update(aiProposals)
      .set({
        state,
        settledAt: state === "open" ? null : now,
        ...(bookingId ? { bookingId } : {}),
        ...(customer
          ? {
              customerName: customer.name,
              customerEmail: customer.email,
              customerPhone: customer.phone,
            }
          : {}),
      })
      .where(
        and(
          eq(aiProposals.id, proposalId),
          eq(aiProposals.businessId, businessId),
          eq(aiProposals.state, "confirming"),
        ),
      );
  },
);

/** One proposal of this conversation, for the prompt's "booking status" section. */
export type ProposalOutcome = {
  kind: Proposal["kind"];
  state: Proposal["state"];
  startsAt: Date;
  expiresAt: Date;
  serviceName: string;
  staffName: string;
  code: string | null;
};

/** This conversation's proposals, oldest first (the last 10). */
export const listProposalOutcomes = adminQuery(
  async (
    db,
    { businessId, conversationId }: TenantScoped & { conversationId: string },
  ): Promise<ProposalOutcome[]> => {
    const rows = await db
      .select({
        kind: aiProposals.kind,
        state: aiProposals.state,
        startsAt: aiProposals.startsAt,
        expiresAt: aiProposals.expiresAt,
        createdAt: aiProposals.createdAt,
        serviceName: services.name,
        staffName: staff.name,
        code: bookings.code,
      })
      .from(aiProposals)
      .innerJoin(
        services,
        and(eq(services.id, aiProposals.serviceId), eq(services.businessId, businessId)),
      )
      .innerJoin(staff, and(eq(staff.id, aiProposals.staffId), eq(staff.businessId, businessId)))
      .leftJoin(
        bookings,
        and(eq(bookings.id, aiProposals.bookingId), eq(bookings.businessId, businessId)),
      )
      .where(
        and(eq(aiProposals.businessId, businessId), eq(aiProposals.conversationId, conversationId)),
      )
      .orderBy(desc(aiProposals.createdAt))
      .limit(10);
    return rows.reverse().map(({ createdAt: _, ...row }) => row);
  },
);

/** The code of a booking a confirmed proposal made or changed. */
export const bookingCode = adminQuery(
  async (db, { businessId, bookingId }: TenantScoped & { bookingId: string }) => {
    const [row] = await db
      .select({ code: bookings.code })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
    return row?.code ?? null;
  },
);

export const setConversationOutcome = adminQuery(
  async (
    db,
    {
      businessId,
      conversationId,
      outcome,
    }: TenantScoped & { conversationId: string; outcome: "booked" },
  ): Promise<void> => {
    await db
      .update(aiConversations)
      .set({ outcome })
      .where(
        and(eq(aiConversations.id, conversationId), eq(aiConversations.businessId, businessId)),
      );
  },
);
