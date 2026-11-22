import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * Supabase Realtime for the live dashboard: booking changes reach members of
 * their own business, and never anyone else, even a member of another
 * business who asks for them by filter. Realtime checks each change against
 * the subscriber's RLS SELECT policy (migration realtime_bookings).
 */

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;
type Received = { channel: string; event: string; businessId: string; code: string };

const SETTLE_MS = 4_000;

describe("realtime bookings", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  const clients: SupabaseClient[] = [];
  const received: Received[] = [];

  /** Subscribe and wait until the server confirms it. */
  async function listen(client: SupabaseClient, name: string, filter?: string) {
    const channel: RealtimeChannel = client
      .channel(name)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", ...(filter ? { filter } : {}) },
        (payload) => {
          const row = (payload.new ?? {}) as { business_id?: string; code?: string };
          received.push({
            channel: name,
            event: payload.eventType,
            businessId: row.business_id ?? "",
            code: row.code ?? "",
          });
        },
      );
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          reject(error ?? new Error(status));
      });
    });
  }

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    const [ownerA, ownerB] = await Promise.all([
      users.create("rt-owner-a"),
      users.create("rt-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerA.sub, role: "owner" },
      { businessId: b.business.id, userId: ownerB.sub, role: "owner" },
    ]);
    const clientA = await users.signIn(ownerA);
    const clientB = await users.signIn(ownerB);
    clients.push(clientA, clientB);
    await listen(clientA, "a-own", `business_id=eq.${a.business.id}`);
    await listen(clientA, "a-unfiltered");
    await listen(clientA, "a-snooping-on-b", `business_id=eq.${b.business.id}`);
    await listen(clientB, "b-own", `business_id=eq.${b.business.id}`);
    // Realtime starts streaming a while after confirming a subscription (longer on a
    // cold CI stack). Warm up: book once in each business and wait until every channel
    // that should hear it has. After this, a silent channel means "filtered out", never
    // "not streaming yet", so the checks for nothing arriving mean something.
    const warmUp = new Date("2031-03-01T02:00:00Z");
    for (let round = 0; ; round++) {
      await db.insert(schema.bookings).values([
        bookingValues(a, new Date(warmUp.getTime() + round * 3_600_000), {
          code: `SW-WARM-A${round}`,
        }),
        bookingValues(b, new Date(warmUp.getTime() + round * 3_600_000), {
          code: `SW-WARM-B${round}`,
        }),
      ]);
      const ready = async () => {
        const heard = (channel: string) => received.some((r) => r.channel === channel);
        return heard("a-own") && heard("a-unfiltered") && heard("b-own");
      };
      const deadline = Date.now() + 5_000;
      while (!(await ready()) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (await ready()) break;
      if (round >= 5) throw new Error("Realtime never started streaming");
    }
    // Anything still in flight from the warm-up arrives, then the slate is wiped.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // Warm-up rows were the only events, and none crossed businesses.
    expect(received.filter((r) => r.channel === "a-snooping-on-b")).toEqual([]);
    expect(
      received.filter((r) => r.channel.startsWith("a-") && r.businessId === b.business.id),
    ).toEqual([]);
    // The warm-up rows stay (2031, nobody reads them): deleting them would send DELETE
    // events, which Realtime doesn't filter (see the realtime_bookings migration).
    received.length = 0;
  }, 90_000);

  afterAll(async () => {
    for (const client of clients) await client.removeAllChannels();
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  it("delivers a business's new, changed and cancelled bookings only to its own members", async () => {
    const start = new Date("2031-03-04T02:00:00Z");
    await db.insert(schema.bookings).values(bookingValues(a, start, { code: "SW-RTAA-01" }));
    const [bRow] = await db
      .insert(schema.bookings)
      .values(bookingValues(b, start, { code: "SW-RTBB-01" }))
      .returning({ id: schema.bookings.id });
    await db
      .update(schema.bookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "staff" })
      .where(eq(schema.bookings.id, bRow!.id));

    await expect
      .poll(() => received.filter((r) => r.channel === "b-own").length, { timeout: 15_000 })
      .toBe(2);
    await expect
      .poll(() => received.filter((r) => r.channel === "a-own").length, { timeout: 15_000 })
      .toBe(1);
    // Give any stray event time to arrive before checking that none did.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    expect(received.filter((r) => r.channel === "b-own").map((r) => [r.event, r.code])).toEqual([
      ["INSERT", "SW-RTBB-01"],
      ["UPDATE", "SW-RTBB-01"],
    ]);
    expect(received.filter((r) => r.channel === "a-own").map((r) => r.code)).toEqual([
      "SW-RTAA-01",
    ]);
    // Without a filter, A still only gets A's.
    expect(received.filter((r) => r.channel === "a-unfiltered").map((r) => r.businessId)).toEqual([
      a.business.id,
    ]);
    // Asking for B's bookings by filter gets A nothing: RLS decides, not the filter.
    expect(received.filter((r) => r.channel === "a-snooping-on-b")).toEqual([]);
    expect(received.some((r) => r.channel.startsWith("a-") && r.businessId === b.business.id)).toBe(
      false,
    );
  }, 60_000);

  it("delivers nothing to a client that isn't signed in", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    clients.push(anon);
    await listen(anon, "anon");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await db
      .insert(schema.bookings)
      .values(bookingValues(a, new Date("2031-03-05T02:00:00Z"), { code: "SW-RTAA-02" }));
    await expect
      .poll(() => received.filter((r) => r.code === "SW-RTAA-02" && r.channel === "a-own").length, {
        timeout: 15_000,
      })
      .toBe(1);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(received.filter((r) => r.channel === "anon")).toEqual([]);
  }, 60_000);
});
