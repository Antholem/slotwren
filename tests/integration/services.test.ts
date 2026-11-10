import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServiceFormInput } from "@/lib/validation/services";
import {
  removeService,
  restoreService,
  saveService,
  type ServiceActor,
} from "@/server/catalog/services";
import { listServices } from "@/server/db/queries/services";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The Services page's server actions, minus the session lookup: what an owner
 * and a staff member can do, validation, and delete-vs-archive.
 */
describe("services actions", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: ServiceActor;
  let staffMember: ServiceActor;
  let ownerOfB: ServiceActor;

  const input = (overrides: Partial<ServiceFormInput> = {}): ServiceFormInput => ({
    name: "Scalp Treatment",
    description: "Exfoliate, mask, massage",
    durationMin: 30,
    price: "25",
    bufferBeforeMin: 0,
    bufferAfterMin: 15,
    active: true,
    staffIds: [a.staff.id],
    ...overrides,
  });

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    const [ownerUser, staffUser, ownerBUser] = await Promise.all([
      users.create("svc-owner"),
      users.create("svc-staff"),
      users.create("svc-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerBUser.sub, role: "owner" },
    ]);
    owner = { claims: ownerUser, businessId: a.business.id, role: "owner", currency: "USD" };
    staffMember = { claims: staffUser, businessId: a.business.id, role: "staff", currency: "USD" };
    ownerOfB = { claims: ownerBUser, businessId: b.business.id, role: "owner", currency: "USD" };
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  const serviceRow = async (id: string) =>
    (await db.select().from(schema.services).where(eq(schema.services.id, id)))[0];

  let created: string;

  it("an owner creates a service with its staff", async () => {
    const result = await saveService(owner, input());
    expect(result.ok).toBe(true);
    created = result.ok ? result.data.id : "";

    expect(await serviceRow(created)).toMatchObject({
      businessId: a.business.id,
      name: "Scalp Treatment",
      priceCents: 2500,
      durationMin: 30,
      bufferAfterMin: 15,
      active: true,
      archivedAt: null,
    });
    const listed = (await listServices(owner.claims, a.business.id)).find((s) => s.id === created);
    expect(listed?.staffIds).toEqual([a.staff.id]);
  });

  it("reads prices the way the business's currency writes them", async () => {
    const euro = { ...owner, currency: "EUR" };
    const comma = await saveService(euro, input({ name: "Euro cut", price: "35,50" }));
    expect(comma.ok).toBe(true);
    expect((await serviceRow(comma.ok ? comma.data.id : ""))?.priceCents).toBe(3550);

    // "1,234" is 1234 dollars, but three decimals in euros: refused, not guessed.
    expect(await saveService(euro, input({ price: "1,234" }))).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: "Enter a price like 35 or 35,50." },
    });
    const dollars = await saveService(owner, input({ name: "Dollar cut", price: "1,234" }));
    expect((await serviceRow(dollars.ok ? dollars.data.id : ""))?.priceCents).toBe(123400);
  });

  it("an owner edits it, replacing its staff", async () => {
    const [jonah] = await db
      .insert(schema.staff)
      .values({ businessId: a.business.id, name: "Jonah", color: "violet" })
      .returning();
    const result = await saveService(
      owner,
      input({ price: "30", active: false, staffIds: [jonah!.id] }),
      created,
    );
    expect(result).toEqual({ ok: true, data: { id: created } });
    expect(await serviceRow(created)).toMatchObject({ priceCents: 3000, active: false });
    const listed = (await listServices(owner.claims, a.business.id)).find((s) => s.id === created);
    expect(listed?.staffIds).toEqual([jonah!.id]);
  });

  it("can't save with no staff ticked", async () => {
    const result = await saveService(owner, input({ staffIds: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.fieldErrors?.staffIds?.[0]).toContain("at least one person");
    }
  });

  it.each([
    ["an empty name", { name: " " }, "name"],
    ["a bad price", { price: "35.555" }, "price"],
    ["an odd duration", { durationMin: 33 }, "durationMin"],
    ["a huge buffer", { bufferAfterMin: 500 }, "bufferAfterMin"],
    ["a long description", { description: "x".repeat(161) }, "description"],
  ] as const)("rejects %s", async (_case, overrides, field) => {
    const result = await saveService(owner, input(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors?.[field]).toBeDefined();
  });

  it("refuses staff from another business", async () => {
    const result = await saveService(owner, input({ staffIds: [b.staff.id] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_staff");
  });

  it("staff members get a read-only view: every write is refused", async () => {
    const results = await Promise.all([
      saveService(staffMember, input()),
      saveService(staffMember, input({ name: "Renamed" }), created),
      removeService(staffMember, created),
      restoreService(staffMember, created),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    }
    expect((await serviceRow(created))?.name).toBe("Scalp Treatment");
    // ...but they can read the list.
    expect((await listServices(staffMember.claims, a.business.id)).length).toBeGreaterThan(0);
  });

  it("an owner of another business can't touch this one's services", async () => {
    const edit = await saveService(
      { ...ownerOfB, businessId: b.business.id },
      input({ staffIds: [b.staff.id] }),
      created,
    );
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.code).toBe("not_found");

    // Even claiming business A's id, RLS hides it.
    const spoofed = await removeService({ ...ownerOfB, businessId: a.business.id }, created);
    expect(spoofed.ok).toBe(false);
    expect(await serviceRow(created)).toBeDefined();
  });

  it("deletes a service nobody has booked", async () => {
    const result = await removeService(owner, created);
    expect(result).toEqual({ ok: true, data: { outcome: "deleted" } });
    expect(await serviceRow(created)).toBeUndefined();
  });

  it("archives a service with bookings, and restores it", async () => {
    await db.insert(schema.bookings).values(bookingValues(a, new Date("2030-04-01T01:00:00Z")));

    const removed = await removeService(owner, a.service.id);
    expect(removed).toEqual({ ok: true, data: { outcome: "archived" } });
    const archived = await serviceRow(a.service.id);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.active).toBe(false);
    const listed = (await listServices(owner.claims, a.business.id)).find(
      (s) => s.id === a.service.id,
    );
    expect(listed?.bookingCount).toBe(1);

    expect(await restoreService(owner, a.service.id)).toEqual({
      ok: true,
      data: { id: a.service.id },
    });
    expect((await serviceRow(a.service.id))?.archivedAt).toBeNull();
  });

  it("treats unknown or malformed ids as not found", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const result = await removeService(owner, id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    }
  });
});
