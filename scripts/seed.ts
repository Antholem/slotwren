/**
 * Seeds the Lumen Studio demo business: 3 staff, 6 services, weekly hours,
 * time off, 8 FAQs, 40 customers and ~120 past + ~30 upcoming bookings, plus a
 * demo owner login linked to Mia.
 *
 *   pnpm db:seed                 # local Supabase (default)
 *   SEED_ALLOW_REMOTE=true pnpm db:seed   # anywhere else, deliberately
 *
 * Idempotent: it deletes the existing lumen-studio business (cascading to all
 * its rows) and recreates it, so it doubles as the nightly demo reset.
 *
 * Runs outside Next.js, so it builds its own connection instead of importing
 * src/server/db/client.ts (which is server-only).
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { hashToken, generateToken } from "../src/server/booking/tokens";
import * as schema from "../src/server/db/schema";

import { generateLumenData, type GeneratedBooking } from "./seed/generate";
import {
  BUSINESS,
  CUSTOMERS,
  DEMO_OWNER,
  FAQS,
  HOURS,
  SERVICES,
  STAFF,
  type ServiceKey,
  type StaffKey,
} from "./seed/lumen-studio";

loadEnvConfig(process.cwd(), true);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SECRET_KEY = requireEnv("SUPABASE_SECRET_KEY");

// Refuse to wipe a remote database by accident.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
if (!LOCAL_HOSTS.has(new URL(DATABASE_URL).hostname) && process.env.SEED_ALLOW_REMOTE !== "true") {
  console.error(
    `Refusing to seed ${new URL(DATABASE_URL).hostname}: not a local database.\n` +
      "Set SEED_ALLOW_REMOTE=true if you really mean it.",
  );
  process.exit(1);
}

async function ensureDemoOwner(): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const existing = data.users.find((user) => user.email === DEMO_OWNER.email);
    if (existing) return existing.id;
    if (data.users.length < 200) break;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: DEMO_OWNER.email,
    email_confirm: true,
    user_metadata: { full_name: DEMO_OWNER.fullName },
  });
  if (error) throw error;
  return data.user.id;
}

const emailFor = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")}@example.com`;

function bookingEvents(
  booking: GeneratedBooking & { id: string },
  businessId: string,
  ownerId: string,
): (typeof schema.bookingEvents.$inferInsert)[] {
  const createdBy = { ai: "ai", manual: "staff", page: "customer", widget: "customer" } as const;
  const events: (typeof schema.bookingEvents.$inferInsert)[] = [
    {
      businessId,
      bookingId: booking.id,
      type: "created",
      actor: createdBy[booking.source],
      actorUserId: booking.source === "manual" ? ownerId : null,
      data: { source: booking.source },
      createdAt: booking.createdAt,
    },
  ];
  if (booking.status === "cancelled") {
    events.push({
      businessId,
      bookingId: booking.id,
      type: "cancelled",
      actor: "customer",
      createdAt: booking.cancelledAt!,
    });
  }
  if (booking.status === "completed" || booking.status === "no_show") {
    events.push({
      businessId,
      bookingId: booking.id,
      type: booking.status,
      actor: "staff",
      actorUserId: ownerId,
      createdAt: booking.endsAt,
    });
  }
  return events;
}

async function main() {
  const started = Date.now();
  const now = new Date();
  const ownerId = await ensureDemoOwner();
  const generated = generateLumenData({ now });

  const client = postgres(DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });

  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.businesses).where(eq(schema.businesses.slug, BUSINESS.slug));

      await tx
        .insert(schema.profiles)
        .values({ id: ownerId, fullName: DEMO_OWNER.fullName })
        .onConflictDoUpdate({
          target: schema.profiles.id,
          set: { fullName: DEMO_OWNER.fullName },
        });

      const [business] = await tx
        .insert(schema.businesses)
        .values({ ...BUSINESS, onboardedAt: now })
        .returning({ id: schema.businesses.id });
      const businessId = business!.id;

      await tx.insert(schema.memberships).values({ businessId, userId: ownerId, role: "owner" });

      // Staff, in mockup order so colours come out Mia teal, Jonah violet, Aiko pink.
      const staffRows = await tx
        .insert(schema.staff)
        .values(
          STAFF.map((member, index) => ({
            businessId,
            userId: member.key === "mia" ? ownerId : null,
            name: member.name,
            email: member.email,
            title: member.key === "mia" ? `${member.title} · Admin` : member.title,
            color: schema.staffColorFor(index),
            sortOrder: index,
          })),
        )
        .returning({ id: schema.staff.id });
      const staffId = Object.fromEntries(
        STAFF.map((member, index) => [member.key, staffRows[index]!.id]),
      ) as Record<StaffKey, string>;

      const serviceRows = await tx
        .insert(schema.services)
        .values(
          SERVICES.map((service, index) => ({
            businessId,
            name: service.name,
            description: service.description,
            durationMin: service.durationMin,
            priceCents: service.priceCents,
            bufferBeforeMin: service.bufferBeforeMin,
            bufferAfterMin: service.bufferAfterMin,
            sortOrder: index,
          })),
        )
        .returning({ id: schema.services.id });
      const serviceId = Object.fromEntries(
        SERVICES.map((service, index) => [service.key, serviceRows[index]!.id]),
      ) as Record<ServiceKey, string>;

      await tx.insert(schema.staffServices).values(
        SERVICES.flatMap((service) =>
          service.staff.map((key) => ({
            businessId,
            staffId: staffId[key],
            serviceId: serviceId[service.key],
          })),
        ),
      );

      await tx.insert(schema.availabilityRules).values(
        STAFF.flatMap((member) =>
          HOURS[member.key].map((range) => ({
            businessId,
            staffId: staffId[member.key],
            weekday: range.weekday,
            startTime: `${range.start}:00`,
            endTime: `${range.end}:00`,
          })),
        ),
      );

      await tx.insert(schema.timeOff).values(
        generated.timeOff.map((off) => ({
          businessId,
          staffId: staffId[off.staff],
          startsAt: off.startsAt,
          endsAt: off.endsAt,
          allDay: off.allDay,
          reason: off.reason,
        })),
      );

      await tx
        .insert(schema.faqs)
        .values(FAQS.map((faq, index) => ({ businessId, ...faq, sortOrder: index })));

      const customerRows = await tx
        .insert(schema.customers)
        .values(
          CUSTOMERS.map((customer, index) => ({
            businessId,
            name: customer.name,
            email: emailFor(customer.name),
            phone: customer.phone ?? null,
            timezone: customer.timezone ?? BUSINESS.timezone,
            notes: customer.notes ?? null,
            notesUpdatedAt: customer.notes ? generated.customerSince[index] : null,
            notesUpdatedBy: customer.notes ? ownerId : null,
            createdAt: generated.customerSince[index],
          })),
        )
        .returning({ id: schema.customers.id });

      const bookingRows = await tx
        .insert(schema.bookings)
        .values(
          generated.bookings.map((booking) => ({
            businessId,
            code: booking.code,
            serviceId: serviceId[booking.service],
            staffId: staffId[booking.staff],
            customerId: customerRows[booking.customerIndex]!.id,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            bufferedStart: booking.bufferedStart,
            bufferedEnd: booking.bufferedEnd,
            status: booking.status,
            source: booking.source,
            priceCents: booking.priceCents,
            customerNotes: booking.customerNotes,
            customerTimezone: booking.customerTimezone,
            // Seeded links are never sent, so the raw tokens are discarded.
            manageTokenHash: hashToken(generateToken()),
            createdByUserId: booking.source === "manual" ? ownerId : null,
            cancelledAt: booking.cancelledAt,
            cancelledBy: booking.cancelledAt ? ("customer" as const) : null,
            createdAt: booking.createdAt,
            updatedAt: booking.cancelledAt ?? booking.createdAt,
          })),
        )
        .returning({ id: schema.bookings.id });

      await tx
        .insert(schema.bookingEvents)
        .values(
          generated.bookings.flatMap((booking, index) =>
            bookingEvents({ ...booking, id: bookingRows[index]!.id }, businessId, ownerId),
          ),
        );
    });
  } finally {
    await client.end();
  }

  const past = generated.bookings.filter((b) => b.endsAt <= now);
  const upcoming = generated.bookings.filter((b) => b.startsAt >= now);
  const byStatus = (list: GeneratedBooking[]) =>
    Object.entries(Object.groupBy(list, (b) => b.status))
      .map(([status, rows]) => `${status} ${rows!.length}`)
      .join(", ");

  console.log(`Seeded ${BUSINESS.name} (/b/${BUSINESS.slug}) in ${Date.now() - started} ms`);
  console.log(
    `  staff ${STAFF.length}, services ${SERVICES.length}, FAQs ${FAQS.length}, customers ${CUSTOMERS.length}`,
  );
  console.log(`  past bookings ${past.length} (${byStatus(past)})`);
  console.log(`  upcoming bookings ${upcoming.length} (${byStatus(upcoming)})`);
  console.log(`  time off ${generated.timeOff.length}; demo owner ${DEMO_OWNER.email}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
