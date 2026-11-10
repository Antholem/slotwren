import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { INVITE_TTL_DAYS } from "@/lib/validation/staff";
import type { RlsClaims } from "@/server/db/client";
import {
  acceptInvite,
  acceptMyInvite,
  inviteExistingStaff,
  inviteStaff,
  resendInvite,
  revokeInvite,
  saveStaff,
  type StaffActor,
} from "@/server/catalog/staff";
import { listMyPendingInvites, listStaff } from "@/server/db/queries/staff";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * Staff and invites: the Staff page's server functions and the
 * private.accept_staff_invite() database function, as real users.
 */

const tokenOf = (inviteUrl: string) => new URL(inviteUrl).pathname.split("/").pop()!;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("staff and invites", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let ownerA: StaffActor;
  let staffActorA: StaffActor;
  let ownerB: StaffActor;
  let invitee: RlsClaims & { email: string };
  let stranger: RlsClaims & { email: string };

  const inviteRow = (staffId: string) =>
    db.select().from(schema.staffInvites).where(eq(schema.staffInvites.staffId, staffId));
  const staffRow = async (id: string) =>
    (await db.select().from(schema.staff).where(eq(schema.staff.id, id)))[0];

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    const [ownerUserA, staffUserA, ownerUserB] = await Promise.all([
      users.create("team-owner-a"),
      users.create("team-staff-a"),
      users.create("team-owner-b"),
    ]);
    invitee = await users.create("team-invitee");
    stranger = await users.create("team-stranger");

    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUserA.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUserA.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    // A's fixture staff member is the owner, with hours that new staff copy.
    await db
      .update(schema.staff)
      .set({ userId: ownerUserA.sub, email: ownerUserA.email })
      .where(eq(schema.staff.id, a.staff.id));
    await db.insert(schema.availabilityRules).values([
      {
        businessId: a.business.id,
        staffId: a.staff.id,
        weekday: 2,
        startTime: "09:00",
        endTime: "18:00",
      },
      {
        businessId: a.business.id,
        staffId: a.staff.id,
        weekday: 3,
        startTime: "09:00",
        endTime: "18:00",
      },
    ]);

    const actor = (claims: RlsClaims, businessId: string, role: "owner" | "staff") => ({
      claims,
      businessId,
      role,
      businessName: "Test Studio",
      timezone: "Asia/Manila",
      actorName: "Mia",
    });
    ownerA = actor(ownerUserA, a.business.id, "owner");
    staffActorA = actor(staffUserA, a.business.id, "staff");
    ownerB = actor(ownerUserB, b.business.id, "owner");
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("staff without a login", () => {
    let jonahId: string;

    it("an owner adds someone: next colour, their services, and the owner's hours to start", async () => {
      const result = await saveStaff(ownerA, {
        name: "Jonah",
        title: "Stylist",
        active: true,
        serviceIds: [a.service.id],
      });
      expect(result.ok).toBe(true);
      jonahId = result.ok ? result.data.id : "";

      expect(await staffRow(jonahId)).toMatchObject({
        name: "Jonah",
        title: "Stylist",
        color: "violet", // second person: teal, violet, pink…
        active: true,
        userId: null,
      });
      const listed = (await listStaff(ownerA.claims, a.business.id, new Date())).find(
        (s) => s.id === jonahId,
      );
      expect(listed?.serviceIds).toEqual([a.service.id]);
      expect(listed?.hours).toHaveLength(2);
    });

    it("deactivating keeps them, their services and history, just off booking", async () => {
      const result = await saveStaff(
        ownerA,
        { name: "Jonah", title: "Stylist", active: false, serviceIds: [a.service.id] },
        jonahId,
      );
      expect(result.ok).toBe(true);
      expect((await staffRow(jonahId))?.active).toBe(false);
      const listed = (await listStaff(ownerA.claims, a.business.id, new Date())).find(
        (s) => s.id === jonahId,
      );
      expect(listed).toMatchObject({ active: false, serviceIds: [a.service.id] });
    });

    it("rejects services from another business", async () => {
      const result = await saveStaff(ownerA, {
        name: "X",
        title: "",
        active: true,
        serviceIds: [b.service.id],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_services");
    });

    it("an existing staff member can be invited to sign in, keeping their row", async () => {
      const result = await inviteExistingStaff(ownerA, jonahId, { email: "Jonah@Example.com" });
      expect(result.ok).toBe(true);
      const [invite] = await inviteRow(jonahId);
      expect(invite).toMatchObject({ email: "jonah@example.com", createdStaff: false });

      // Revoking that invite leaves Jonah on the team.
      expect((await revokeInvite(ownerA, invite!.id)).ok).toBe(true);
      expect(await staffRow(jonahId)).toBeDefined();
      expect(await inviteRow(jonahId)).toEqual([]);
    });
  });

  describe("invites", () => {
    let inviteUrl: string;
    let staffId: string;

    it("creates an inactive staff row and an invite with a hashed token that lasts 7 days", async () => {
      const before = Date.now();
      const result = await inviteStaff(ownerA, {
        email: invitee.email.toUpperCase(),
        name: "",
        serviceIds: [a.service.id],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      inviteUrl = result.data.inviteUrl;
      expect(result.data.emailSent).toBe(false); // no RESEND_API_KEY locally: logged instead
      expect(inviteUrl).toMatch(/\/invite\/[\w-]{40,}$/);

      const [invite] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.email, invitee.email));
      staffId = invite!.staffId;
      expect(invite!.tokenHash).toBe(sha256(tokenOf(inviteUrl)));
      expect(invite!.tokenHash).not.toContain(tokenOf(inviteUrl));
      expect(invite!.createdStaff).toBe(true);
      const ttl = invite!.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan((INVITE_TTL_DAYS * 24 - 1) * 3600_000);
      expect(ttl).toBeLessThanOrEqual(INVITE_TTL_DAYS * 24 * 3600_000 + 60_000);
      expect(await staffRow(staffId)).toMatchObject({ active: false, userId: null });
    });

    it("shows the pending invite to owners only", async () => {
      const asOwner = (await listStaff(ownerA.claims, a.business.id, new Date())).find(
        (s) => s.id === staffId,
      );
      expect(asOwner?.invite?.email).toBe(invitee.email);
      const asStaff = (await listStaff(staffActorA.claims, a.business.id, new Date())).find(
        (s) => s.id === staffId,
      );
      expect(asStaff?.invite).toBeNull();
    });

    it("won't invite the same email twice, or someone already on the team", async () => {
      const again = await inviteStaff(ownerA, { email: invitee.email, name: "", serviceIds: [] });
      expect(again.ok === false && again.error.code).toBe("already_invited");
      const owner = await inviteStaff(ownerA, {
        email: ownerA.claims.email!,
        name: "",
        serviceIds: [],
      });
      expect(owner.ok === false && owner.error.code).toBe("already_on_team");
    });

    it("refuses the wrong account and leaves the invite pending", async () => {
      const result = await acceptInvite(stranger, tokenOf(inviteUrl));
      expect(result.ok === false && result.error.code).toBe("wrong_account");
      expect((await inviteRow(staffId))[0]?.acceptedAt).toBeNull();
    });

    it("resend rotates the token: the old link stops working", async () => {
      const [invite] = await inviteRow(staffId);
      const resent = await resendInvite(ownerA, invite!.id);
      expect(resent.ok).toBe(true);
      if (!resent.ok) return;
      expect(resent.data.inviteUrl).not.toBe(inviteUrl);

      const old = await acceptInvite(invitee, tokenOf(inviteUrl));
      expect(old.ok === false && old.error.code).toBe("invalid");
      inviteUrl = resent.data.inviteUrl;
    });

    it("accepting makes them staff, links and switches on their staff row, and uses the invite", async () => {
      const result = await acceptInvite(invitee, tokenOf(inviteUrl));
      expect(result).toEqual({ ok: true, data: { businessId: a.business.id } });

      const [membership] = await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.businessId, a.business.id),
            eq(schema.memberships.userId, invitee.sub),
          ),
        );
      expect(membership?.role).toBe("staff");
      expect(await staffRow(staffId)).toMatchObject({ userId: invitee.sub, active: true });
      expect((await inviteRow(staffId))[0]?.acceptedAt).toBeInstanceOf(Date);

      const twice = await acceptInvite(invitee, tokenOf(inviteUrl));
      expect(twice.ok === false && twice.error.code).toBe("used");
    });

    it("refuses an expired invite", async () => {
      const created = await inviteStaff(ownerA, {
        email: `late-${Date.now()}@example.com`,
        name: "Late",
        serviceIds: [],
      });
      if (!created.ok) throw new Error(created.error.message);
      await db
        .update(schema.staffInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.staffInvites.tokenHash, sha256(tokenOf(created.data.inviteUrl))));
      const result = await acceptInvite(stranger, tokenOf(created.data.inviteUrl));
      expect(result.ok === false && result.error.code).toBe("expired");
    });

    it("revoking removes the invite and the placeholder it created", async () => {
      const created = await inviteStaff(ownerA, {
        email: `gone-${Date.now()}@example.com`,
        name: "Gone",
        serviceIds: [],
      });
      if (!created.ok) throw new Error(created.error.message);
      const [invite] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.tokenHash, sha256(tokenOf(created.data.inviteUrl))));

      expect((await revokeInvite(ownerA, invite!.id)).ok).toBe(true);
      expect(await staffRow(invite!.staffId)).toBeUndefined();
      const result = await acceptInvite(stranger, tokenOf(created.data.inviteUrl));
      expect(result.ok === false && result.error.code).toBe("invalid");
    });

    it("an owner already in the business marks it used without changing their role", async () => {
      const created = await inviteStaff(ownerB, {
        email: `self-${Date.now()}@example.com`,
        name: "",
        serviceIds: [],
      });
      if (!created.ok) throw new Error(created.error.message);
      await db
        .update(schema.staffInvites)
        .set({ email: ownerB.claims.email! })
        .where(eq(schema.staffInvites.tokenHash, sha256(tokenOf(created.data.inviteUrl))));
      const result = await acceptInvite(ownerB.claims, tokenOf(created.data.inviteUrl));
      expect(result).toEqual({ ok: true, data: { businessId: b.business.id } });
      const [membership] = await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, ownerB.claims.sub));
      expect(membership?.role).toBe("owner");
    });
  });

  describe("roles and tenants", () => {
    it("staff members can't change the team", async () => {
      const results = await Promise.all([
        saveStaff(staffActorA, { name: "X", title: "", active: true, serviceIds: [] }),
        inviteStaff(staffActorA, { email: "x@example.com", name: "", serviceIds: [] }),
        inviteExistingStaff(staffActorA, a.staff.id, { email: "x@example.com" }),
        resendInvite(staffActorA, crypto.randomUUID()),
        revokeInvite(staffActorA, crypto.randomUUID()),
      ]);
      for (const result of results)
        expect(result.ok === false && result.error.code).toBe("forbidden");
    });

    it("an owner can't touch another business's staff or invites", async () => {
      const created = await inviteStaff(ownerB, {
        email: `b-${Date.now()}@example.com`,
        name: "B person",
        serviceIds: [],
      });
      if (!created.ok) throw new Error(created.error.message);
      const [bInvite] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.tokenHash, sha256(tokenOf(created.data.inviteUrl))));

      expect((await revokeInvite(ownerA, bInvite!.id)).ok).toBe(false);
      expect((await resendInvite(ownerA, bInvite!.id)).ok).toBe(false);
      expect((await inviteExistingStaff(ownerA, b.staff.id, { email: "x@example.com" })).ok).toBe(
        false,
      );
      expect(
        (
          await saveStaff(
            ownerA,
            { name: "Hijack", title: "", active: true, serviceIds: [] },
            b.staff.id,
          )
        ).ok,
      ).toBe(false);
      // B's invite is untouched.
      expect(
        (
          await db.select().from(schema.staffInvites).where(eq(schema.staffInvites.id, bInvite!.id))
        )[0]?.tokenHash,
      ).toBe(bInvite!.tokenHash);
    });

    it("a token from another business joins that business only", async () => {
      const email = `cross-${Date.now()}@example.com`;
      const created = await inviteStaff(ownerB, { email, name: "Cross", serviceIds: [] });
      if (!created.ok) throw new Error(created.error.message);
      const crosser = await users.create("team-cross");
      await db
        .update(schema.staffInvites)
        .set({ email: crosser.email })
        .where(eq(schema.staffInvites.tokenHash, sha256(tokenOf(created.data.inviteUrl))));

      const result = await acceptInvite(crosser, tokenOf(created.data.inviteUrl));
      expect(result).toEqual({ ok: true, data: { businessId: b.business.id } });
      const joined = await db
        .select({ businessId: schema.memberships.businessId })
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, crosser.sub));
      expect(joined).toEqual([{ businessId: b.business.id }]);
    });
  });

  describe("private.accept_staff_invite()", () => {
    it("needs a signed-in user", async () => {
      const [row] = await db.execute<{ result: { outcome: string } }>(
        sql`select private.accept_staff_invite('anything') as result`,
      );
      expect(row?.result.outcome).toBe("not_signed_in");
    });

    it("treats unknown and malformed tokens as invalid", async () => {
      for (const token of ["x".repeat(43), "not a token at all, but long enough"]) {
        const result = await acceptInvite(stranger, token);
        expect(result.ok === false && result.error.code).toBe("invalid");
      }
    });

    it("can't be called by the anon role", async () => {
      const [row] = await db.execute<{ allowed: boolean }>(
        sql`select has_function_privilege('anon', 'private.accept_staff_invite(text)', 'execute') as allowed`,
      );
      expect(row?.allowed).toBe(false);
    });
  });

  // Signed in on another device: no invite link, just the right email.
  describe("invites by email, without the link", () => {
    let phoneUser: RlsClaims & { email: string };
    let inviteId: string;

    beforeAll(async () => {
      phoneUser = await users.create("team-phone");
      const created = await inviteStaff(ownerB, {
        email: phoneUser.email.toUpperCase(), // emails match case-insensitively
        name: "Pat",
        serviceIds: [],
      });
      expect(created.ok).toBe(true);
      const [row] = await db
        .select({ id: schema.staffInvites.id })
        .from(schema.staffInvites)
        .where(eq(sql`lower(${schema.staffInvites.email})`, phoneUser.email.toLowerCase()));
      inviteId = row!.id;
    });

    it("lists only invites sent to the signed-in user's own email", async () => {
      const mine = await listMyPendingInvites(phoneUser);
      expect(mine).toEqual([
        expect.objectContaining({ inviteId, businessName: b.business.name, staffName: "Pat" }),
      ]);
      expect(await listMyPendingInvites(stranger)).toEqual([]);
    });

    it("refuses someone else's invite, even with its id", async () => {
      const result = await acceptMyInvite(stranger, inviteId);
      expect(result).toMatchObject({ ok: false, error: { code: "wrong_account" } });
      expect(await acceptMyInvite(stranger, "not-a-uuid")).toMatchObject({
        ok: false,
        error: { code: "invalid" },
      });
    });

    it("accepts by id for the invitee, as staff", async () => {
      const result = await acceptMyInvite(phoneUser, inviteId);
      expect(result).toEqual({ ok: true, data: { businessId: b.business.id } });
      const [membership] = await db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.businessId, b.business.id),
            eq(schema.memberships.userId, phoneUser.sub),
          ),
        );
      expect(membership?.role).toBe("staff");
      expect(await listMyPendingInvites(phoneUser)).toEqual([]);
    });

    it("leaves expired invites out", async () => {
      const late = await users.create("team-late");
      await inviteStaff(ownerB, { email: late.email, name: "Late", serviceIds: [] });
      await db
        .update(schema.staffInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.staffInvites.email, late.email));
      expect(await listMyPendingInvites(late)).toEqual([]);
    });

    it("can't be called by the anon role", async () => {
      for (const fn of ["private.accept_my_staff_invite(uuid)", "private.my_pending_invites()"]) {
        const [row] = await db.execute<{ allowed: boolean }>(
          sql`select has_function_privilege('anon', ${fn}, 'execute') as allowed`,
        );
        expect(row?.allowed, fn).toBe(false);
      }
      const [row] = await db.execute<{ allowed: boolean }>(
        sql`select has_function_privilege('authenticated', 'private.claim_staff_invite(public.staff_invites, uuid)', 'execute') as allowed`,
      );
      expect(row?.allowed).toBe(false);
    });
  });
});
