import "server-only";

import { z } from "zod";

import { StaffInviteEmail } from "@/emails/staff-invite";
import { env } from "@/env";
import { formatInZone } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import {
  INVITE_TTL_DAYS,
  inviteExistingSchema,
  inviteFormSchema,
  staffFormSchema,
} from "@/lib/validation/staff";
import { generateToken, hashToken } from "@/server/booking/tokens";
import type { RlsClaims } from "@/server/db/client";
import { isUniqueViolation, pgError } from "@/server/db/errors";
import { staffNameFor } from "@/server/db/queries/onboarding";
import {
  acceptInvite as acceptInviteRow,
  type AcceptOutcome,
  createStaff,
  emailOnTeam,
  inviteExistingStaff as inviteExistingStaffRow,
  inviteNewStaff,
  revokeInvite as revokeInviteRow,
  rotateInvite,
  updateStaff,
} from "@/server/db/queries/staff";
import { sendEmail } from "@/server/email/send";

import type { Actor } from "./services";

/*
 * What the Staff page and the invite page do, minus reading the session:
 * owners-only writes, validation, invite tokens (random, returned once,
 * stored hashed), the invite email, and Results with messages safe to show.
 * Tested directly in tests/integration/staff.test.ts.
 */

export type StaffActor = Actor & {
  businessName: string;
  /** The business timezone: dates in emails read as the business reads them. */
  timezone: string;
  actorName: string | null;
};

const FORBIDDEN = "Only owners can change the team. Ask an owner to make this change.";
const NOT_FOUND = "That person or invite no longer exists. Refresh to see the latest team.";
const idSchema = z.uuid();

function invalid(error: z.ZodError) {
  const { fieldErrors } = z.flattenError(error);
  const first = Object.values(fieldErrors).flat()[0] as string | undefined;
  return err("invalid_input", first ?? "Check the highlighted fields.", fieldErrors);
}

const badServices = () =>
  err("invalid_services", "Pick services from your menu.", {
    serviceIds: ["Pick services from your menu."],
  });

export async function saveStaff(
  actor: Actor,
  input: unknown,
  staffId?: string,
): Promise<
  Result<{ id: string }, "forbidden" | "invalid_input" | "invalid_services" | "not_found">
> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (staffId !== undefined && !idSchema.safeParse(staffId).success)
    return err("not_found", NOT_FOUND);
  const parsed = staffFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    if (staffId) {
      const found = await updateStaff(actor.claims, actor.businessId, staffId, parsed.data);
      return found ? ok({ id: staffId }) : err("not_found", NOT_FOUND);
    }
    return ok({ id: await createStaff(actor.claims, actor.businessId, parsed.data) });
  } catch (error) {
    // A service id from another business fails the composite foreign key.
    if (pgError(error).code === "23503") return badServices();
    throw error;
  }
}

// ── Invites ─────────────────────────────────────────────────────────────

type InviteSent = { inviteUrl: string; emailSent: boolean };
type InviteError =
  | "forbidden"
  | "invalid_input"
  | "invalid_services"
  | "not_found"
  | "already_on_team"
  | "already_invited";

function newInvite() {
  const token = generateToken();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

const inviteUrlFor = (token: string) =>
  new URL(`/invite/${token}`, env.NEXT_PUBLIC_APP_URL).toString();

async function sendInviteEmail(
  actor: StaffActor,
  to: string,
  inviteeName: string,
  inviteUrl: string,
  expiresAt: Date,
) {
  const result = await sendEmail({
    to,
    subject: `Join ${actor.businessName} on Slotwren`,
    react: StaffInviteEmail({
      businessName: actor.businessName,
      inviterName: actor.actorName,
      inviteeName,
      acceptUrl: inviteUrl,
      expiresOn: formatInZone(expiresAt, actor.timezone, "d MMMM"),
    }),
    logLines: [`Invite link for ${to}: ${inviteUrl}`],
  });
  return result.delivered;
}

const ALREADY_ON_TEAM = "They're already on your team.";
const ALREADY_INVITED = "They already have a pending invite. Resend it from their card.";

/** Invite a new person: a placeholder staff row that switches on when they accept. */
export async function inviteStaff(
  actor: StaffActor,
  input: unknown,
): Promise<Result<InviteSent, InviteError>> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  const parsed = inviteFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const values = parsed.data;

  const existing = await emailOnTeam(actor.claims, actor.businessId, values.email);
  if (existing === "member") {
    return err("already_on_team", ALREADY_ON_TEAM, { email: [ALREADY_ON_TEAM] });
  }
  if (existing === "invited") {
    return err("already_invited", ALREADY_INVITED, { email: [ALREADY_INVITED] });
  }

  const name = values.name ?? staffNameFor(null, values.email);
  const invite = newInvite();
  try {
    await inviteNewStaff(actor.claims, actor.businessId, { ...values, name }, invite);
  } catch (error) {
    if (pgError(error).code === "23503") return badServices();
    throw error;
  }
  const inviteUrl = inviteUrlFor(invite.token);
  const emailSent = await sendInviteEmail(actor, values.email, name, inviteUrl, invite.expiresAt);
  return ok({ inviteUrl, emailSent });
}

/** Give an existing staff member (no login yet) an invite. */
export async function inviteExistingStaff(
  actor: StaffActor,
  staffId: string,
  input: unknown,
): Promise<Result<InviteSent, InviteError>> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (!idSchema.safeParse(staffId).success) return err("not_found", NOT_FOUND);
  const parsed = inviteExistingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { email } = parsed.data;

  if ((await emailOnTeam(actor.claims, actor.businessId, email)) === "member") {
    return err("already_on_team", ALREADY_ON_TEAM, { email: [ALREADY_ON_TEAM] });
  }
  const invite = newInvite();
  let staffName: string;
  try {
    const outcome = await inviteExistingStaffRow(
      actor.claims,
      actor.businessId,
      staffId,
      email,
      invite,
    );
    if (outcome.status !== "invited") {
      return outcome.status === "not_found"
        ? err("not_found", NOT_FOUND)
        : err("already_on_team", "They already sign in to Slotwren.");
    }
    staffName = outcome.name;
  } catch (error) {
    if (isUniqueViolation(error, "staff_invites_one_pending")) {
      return err("already_invited", ALREADY_INVITED, { email: [ALREADY_INVITED] });
    }
    throw error;
  }
  const inviteUrl = inviteUrlFor(invite.token);
  const emailSent = await sendInviteEmail(actor, email, staffName, inviteUrl, invite.expiresAt);
  return ok({ inviteUrl, emailSent });
}

/** New token and seven more days; the old link stops working. */
export async function resendInvite(
  actor: StaffActor,
  inviteId: string,
): Promise<Result<InviteSent, "forbidden" | "not_found">> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (!idSchema.safeParse(inviteId).success) return err("not_found", NOT_FOUND);
  const invite = newInvite();
  const rotated = await rotateInvite(actor.claims, actor.businessId, inviteId, invite);
  if (!rotated) return err("not_found", NOT_FOUND);
  const inviteUrl = inviteUrlFor(invite.token);
  const emailSent = await sendInviteEmail(
    actor,
    rotated.email,
    rotated.staffName,
    inviteUrl,
    invite.expiresAt,
  );
  return ok({ inviteUrl, emailSent });
}

export async function revokeInvite(
  actor: Actor,
  inviteId: string,
): Promise<Result<{ id: string }, "forbidden" | "not_found">> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (!idSchema.safeParse(inviteId).success) return err("not_found", NOT_FOUND);
  const outcome = await revokeInviteRow(actor.claims, actor.businessId, inviteId);
  return outcome === "revoked" ? ok({ id: inviteId }) : err("not_found", NOT_FOUND);
}

// ── Accepting ───────────────────────────────────────────────────────────

const ACCEPT_MESSAGES: Record<Exclude<AcceptOutcome, "accepted" | "already_member">, string> = {
  invalid:
    "This invite link isn't valid any more. It may have been replaced by a newer one or cancelled. Ask the person who invited you to send it again.",
  used: "This invite has already been used. Sign in with the account that accepted it.",
  expired:
    "This invite has expired. Ask the person who invited you to resend it; new links last 7 days.",
  wrong_account:
    "This invite was sent to a different email address. Sign out, then sign in with the address it was sent to.",
  not_signed_in: "Sign in to accept this invite.",
};

/** Accept an invite as the signed-in user (private.accept_staff_invite). */
export async function acceptInvite(
  claims: RlsClaims,
  token: unknown,
): Promise<Result<{ businessId: string }, Exclude<AcceptOutcome, "accepted" | "already_member">>> {
  const parsed = z.string().min(20).max(200).safeParse(token);
  if (!parsed.success) return err("invalid", ACCEPT_MESSAGES.invalid);
  const { outcome, businessId } = await acceptInviteRow(claims, parsed.data);
  if ((outcome === "accepted" || outcome === "already_member") && businessId) {
    return ok({ businessId });
  }
  const code = outcome as keyof typeof ACCEPT_MESSAGES;
  return err(code, ACCEPT_MESSAGES[code]);
}

export { ACCEPT_MESSAGES };
