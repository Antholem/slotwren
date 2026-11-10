import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, eq, gt, isNull, max, sql } from "drizzle-orm";

import type { InviteFormValues, StaffFormValues } from "@/lib/validation/staff";

import { type RlsClaims, type Transaction, withRls } from "../client";
import {
  availabilityRules,
  bookings,
  memberships,
  staff,
  staffColorFor,
  staffInvites,
  staffServices,
  timeOff,
} from "../schema";

/*
 * Staff and invites for the dashboard, as the signed-in member (withRls),
 * always filtered by business_id. RLS limits writes, and invites, to owners.
 */

export type PendingInvite = {
  id: string;
  email: string;
  expiresAt: Date;
  sentAt: Date;
  expired: boolean;
};

export type DashboardStaff = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  color: "teal" | "violet" | "pink";
  active: boolean;
  /** Has a login (accepted an invite, or is the owner). */
  linked: boolean;
  isOwner: boolean;
  serviceIds: string[];
  hours: { weekday: number; startTime: string; endTime: string }[];
  upcomingTimeOff: number;
  /** Upcoming time off, plus the last 90 days for "Show past". */
  timeOff: { id: string; startsAt: Date; endsAt: Date; allDay: boolean; reason: string | null }[];
  /** This row is the signed-in member (staff may edit their own schedule). */
  isMe: boolean;
  /** Owners only: RLS hides invites from staff. */
  invite: PendingInvite | null;
};

export async function listStaff(
  claims: RlsClaims,
  businessId: string,
  now: Date,
): Promise<DashboardStaff[]> {
  return withRls(claims, async (tx) => {
    const people = await tx
      .select({
        id: staff.id,
        name: staff.name,
        title: staff.title,
        email: staff.email,
        color: staff.color,
        active: staff.active,
        userId: staff.userId,
      })
      .from(staff)
      .where(eq(staff.businessId, businessId))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt));

    const [assigned, rules, offs, invites, owners] = await Promise.all([
      tx
        .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
        .from(staffServices)
        .where(eq(staffServices.businessId, businessId)),
      tx
        .select({
          staffId: availabilityRules.staffId,
          weekday: availabilityRules.weekday,
          startTime: availabilityRules.startTime,
          endTime: availabilityRules.endTime,
        })
        .from(availabilityRules)
        .where(eq(availabilityRules.businessId, businessId)),
      tx
        .select({
          id: timeOff.id,
          staffId: timeOff.staffId,
          startsAt: timeOff.startsAt,
          endsAt: timeOff.endsAt,
          allDay: timeOff.allDay,
          reason: timeOff.reason,
        })
        .from(timeOff)
        .where(
          and(
            eq(timeOff.businessId, businessId),
            gt(timeOff.endsAt, new Date(now.getTime() - 90 * 24 * 3_600_000)),
          ),
        )
        .orderBy(asc(timeOff.startsAt)),
      tx
        .select({
          id: staffInvites.id,
          staffId: staffInvites.staffId,
          email: staffInvites.email,
          expiresAt: staffInvites.expiresAt,
          sentAt: staffInvites.sentAt,
        })
        .from(staffInvites)
        .where(and(eq(staffInvites.businessId, businessId), isNull(staffInvites.acceptedAt))),
      tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.businessId, businessId), eq(memberships.role, "owner"))),
    ]);
    const ownerIds = new Set(owners.map((o) => o.userId));

    return people.map(({ userId, ...person }) => {
      const invite = invites.find((i) => i.staffId === person.id);
      return {
        ...person,
        linked: userId !== null,
        isOwner: userId !== null && ownerIds.has(userId),
        serviceIds: assigned.filter((a) => a.staffId === person.id).map((a) => a.serviceId),
        hours: rules.filter((r) => r.staffId === person.id).map(({ staffId: _s, ...rule }) => rule),
        upcomingTimeOff: offs.filter((o) => o.staffId === person.id && o.endsAt > now).length,
        timeOff: offs
          .filter((o) => o.staffId === person.id)
          .map(({ staffId: _s, ...entry }) => entry),
        isMe: userId === claims.sub,
        invite: invite
          ? {
              id: invite.id,
              email: invite.email,
              expiresAt: invite.expiresAt,
              sentAt: invite.sentAt,
              expired: invite.expiresAt <= now,
            }
          : null,
      };
    });
  });
}

async function assignServices(
  tx: Transaction,
  businessId: string,
  staffId: string,
  serviceIds: string[],
) {
  await tx
    .delete(staffServices)
    .where(and(eq(staffServices.businessId, businessId), eq(staffServices.staffId, staffId)));
  if (serviceIds.length > 0) {
    await tx
      .insert(staffServices)
      .values(serviceIds.map((serviceId) => ({ businessId, staffId, serviceId })));
  }
}

/**
 * A new staff row: next colour in the cycle, end of the list, and the
 * acting owner's weekly hours as a starting point.
 */
async function insertStaff(
  tx: Transaction,
  businessId: string,
  ownerUserId: string,
  values: {
    name: string;
    title: string | null;
    email: string | null;
    active: boolean;
    serviceIds: string[];
  },
) {
  const [{ n, last }] = (await tx
    .select({ n: count(), last: max(staff.sortOrder) })
    .from(staff)
    .where(eq(staff.businessId, businessId))) as [{ n: number; last: number | null }];
  const id = randomUUID();
  await tx.insert(staff).values({
    id,
    businessId,
    name: values.name,
    title: values.title,
    email: values.email,
    active: values.active,
    color: staffColorFor(n),
    sortOrder: (last ?? -1) + 1,
  });
  await assignServices(tx, businessId, id, values.serviceIds);

  const [ownerStaff] = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.businessId, businessId), eq(staff.userId, ownerUserId)))
    .limit(1);
  if (ownerStaff) {
    await tx.execute(sql`
      insert into public.availability_rules (business_id, staff_id, weekday, start_time, end_time)
      select business_id, ${id}, weekday, start_time, end_time
      from public.availability_rules
      where business_id = ${businessId} and staff_id = ${ownerStaff.id}
    `);
  }
  return id;
}

export async function createStaff(
  claims: RlsClaims,
  businessId: string,
  values: StaffFormValues,
): Promise<string> {
  return withRls(claims, (tx) =>
    insertStaff(tx, businessId, claims.sub, { ...values, email: null }),
  );
}

/** False if no such staff member in this business (or RLS hid the write). */
export async function updateStaff(
  claims: RlsClaims,
  businessId: string,
  staffId: string,
  { serviceIds, ...values }: StaffFormValues,
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const updated = await tx
      .update(staff)
      .set(values)
      .where(and(eq(staff.id, staffId), eq(staff.businessId, businessId)))
      .returning({ id: staff.id });
    if (updated.length === 0) return false;
    await assignServices(tx, businessId, staffId, serviceIds);
    return true;
  });
}

/** Whether this email already belongs to someone on the team or a pending invite. */
export async function emailOnTeam(
  claims: RlsClaims,
  businessId: string,
  email: string,
): Promise<"member" | "invited" | null> {
  return withRls(claims, async (tx) => {
    const [member] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.businessId, businessId),
          sql`lower(${staff.email}) = ${email}`,
          sql`${staff.userId} is not null`,
        ),
      )
      .limit(1);
    if (member) return "member";
    const [invited] = await tx
      .select({ id: staffInvites.id })
      .from(staffInvites)
      .where(
        and(
          eq(staffInvites.businessId, businessId),
          isNull(staffInvites.acceptedAt),
          sql`lower(${staffInvites.email}) = ${email}`,
        ),
      )
      .limit(1);
    return invited ? "invited" : null;
  });
}

type NewInvite = { tokenHash: string; expiresAt: Date };

/** "Invite a team member": a placeholder staff row (off until accepted) and its invite. */
export async function inviteNewStaff(
  claims: RlsClaims,
  businessId: string,
  values: InviteFormValues & { name: string },
  invite: NewInvite,
): Promise<{ staffId: string; inviteId: string }> {
  return withRls(claims, async (tx) => {
    const staffId = await insertStaff(tx, businessId, claims.sub, {
      name: values.name,
      title: null,
      email: values.email,
      active: false,
      serviceIds: values.serviceIds,
    });
    const inviteId = randomUUID();
    await tx.insert(staffInvites).values({
      id: inviteId,
      businessId,
      staffId,
      email: values.email,
      role: "staff",
      tokenHash: invite.tokenHash,
      expiresAt: invite.expiresAt,
      invitedBy: claims.sub,
      createdStaff: true,
    });
    return { staffId, inviteId };
  });
}

/**
 * Invite someone already on the team (a staff row without a login). Throws
 * 23505 (staff_invites_one_pending) if they already have a pending invite.
 */
export async function inviteExistingStaff(
  claims: RlsClaims,
  businessId: string,
  staffId: string,
  email: string,
  invite: NewInvite,
): Promise<{ status: "invited"; name: string } | { status: "not_found" | "already_linked" }> {
  return withRls(claims, async (tx) => {
    const [person] = await tx
      .select({ userId: staff.userId, name: staff.name })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.businessId, businessId)));
    if (!person) return { status: "not_found" };
    if (person.userId) return { status: "already_linked" };
    await tx.insert(staffInvites).values({
      businessId,
      staffId,
      email,
      role: "staff",
      tokenHash: invite.tokenHash,
      expiresAt: invite.expiresAt,
      invitedBy: claims.sub,
      createdStaff: false,
    });
    await tx
      .update(staff)
      .set({ email })
      .where(and(eq(staff.id, staffId), eq(staff.businessId, businessId)));
    return { status: "invited", name: person.name };
  });
}

/** Resend: a fresh token and expiry for a pending invite. The old link stops working. */
export async function rotateInvite(
  claims: RlsClaims,
  businessId: string,
  inviteId: string,
  invite: NewInvite,
): Promise<{ email: string; staffName: string } | null> {
  return withRls(claims, async (tx) => {
    const [updated] = await tx
      .update(staffInvites)
      .set({ tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, sentAt: new Date() })
      .where(
        and(
          eq(staffInvites.id, inviteId),
          eq(staffInvites.businessId, businessId),
          isNull(staffInvites.acceptedAt),
        ),
      )
      .returning({ email: staffInvites.email, staffId: staffInvites.staffId });
    if (!updated) return null;
    const [person] = await tx
      .select({ name: staff.name })
      .from(staff)
      .where(and(eq(staff.id, updated.staffId), eq(staff.businessId, businessId)));
    return { email: updated.email, staffName: person?.name ?? "there" };
  });
}

/**
 * Revoke a pending invite. If the invite created its staff row and nobody
 * has claimed or booked it, that placeholder goes too.
 */
export async function revokeInvite(
  claims: RlsClaims,
  businessId: string,
  inviteId: string,
): Promise<"revoked" | "not_found"> {
  return withRls(claims, async (tx) => {
    const [deleted] = await tx
      .delete(staffInvites)
      .where(
        and(
          eq(staffInvites.id, inviteId),
          eq(staffInvites.businessId, businessId),
          isNull(staffInvites.acceptedAt),
        ),
      )
      .returning({ staffId: staffInvites.staffId, createdStaff: staffInvites.createdStaff });
    if (!deleted) return "not_found";

    if (deleted.createdStaff) {
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(bookings)
        .where(
          and(eq(bookings.businessId, businessId), eq(bookings.staffId, deleted.staffId)),
        )) as [{ n: number }];
      if (n === 0) {
        await tx
          .delete(staff)
          .where(
            and(
              eq(staff.id, deleted.staffId),
              eq(staff.businessId, businessId),
              isNull(staff.userId),
            ),
          );
      }
    }
    return "revoked";
  });
}

export type AcceptOutcome =
  | "accepted"
  | "already_member"
  | "invalid"
  | "used"
  | "expired"
  | "wrong_account"
  | "not_signed_in";

/** private.accept_staff_invite() as the signed-in user (see its migration). */
export async function acceptInvite(
  claims: RlsClaims,
  token: string,
): Promise<{ outcome: AcceptOutcome; businessId: string | null }> {
  const [row] = await withRls(claims, (tx) =>
    tx.execute<{ result: { outcome: AcceptOutcome; business_id?: string } }>(
      sql`select private.accept_staff_invite(${token}) as result`,
    ),
  );
  return { outcome: row!.result.outcome, businessId: row!.result.business_id ?? null };
}

/** The signed-in member's own name on this team ("Mia invited you…"). */
export async function myStaffName(claims: RlsClaims, businessId: string): Promise<string | null> {
  const [row] = await withRls(claims, (tx) =>
    tx
      .select({ name: staff.name })
      .from(staff)
      .where(and(eq(staff.businessId, businessId), eq(staff.userId, claims.sub)))
      .limit(1),
  );
  return row?.name ?? null;
}

export type MyPendingInvite = {
  inviteId: string;
  businessName: string;
  logoUrl: string | null;
  staffName: string;
  expiresAt: Date;
};

/** Pending invites sent to the signed-in user's own email (private.my_pending_invites). */
export async function listMyPendingInvites(claims: RlsClaims): Promise<MyPendingInvite[]> {
  const rows = await withRls(claims, (tx) =>
    tx.execute<{
      invite_id: string;
      business_name: string;
      logo_url: string | null;
      staff_name: string;
      expires_at: string | Date;
    }>(sql`select * from private.my_pending_invites()`),
  );
  return rows.map((row) => ({
    inviteId: row.invite_id,
    businessName: row.business_name,
    logoUrl: row.logo_url,
    staffName: row.staff_name,
    expiresAt: new Date(row.expires_at),
  }));
}

/** private.accept_my_staff_invite(): accept by id, for invites sent to the user's own email. */
export async function acceptMyInvite(
  claims: RlsClaims,
  inviteId: string,
): Promise<{ outcome: AcceptOutcome; businessId: string | null }> {
  const [row] = await withRls(claims, (tx) =>
    tx.execute<{ result: { outcome: AcceptOutcome; business_id?: string } }>(
      sql`select private.accept_my_staff_invite(${inviteId}::uuid) as result`,
    ),
  );
  return { outcome: row!.result.outcome, businessId: row!.result.business_id ?? null };
}
