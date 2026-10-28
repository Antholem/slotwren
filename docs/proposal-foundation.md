# Foundation proposal: folder structure and data model

Status: **approved** (29 Oct 2026), with the notes in §4.

## 1. Folder structure

Follows the brief's layout and fills in the gaps. Next.js 16 uses `src/proxy.ts`, not `middleware.ts`.

```text
slotwren/
├─ .github/workflows/ci.yml          lint · typecheck · unit tests · e2e
├─ docs/
│  ├─ brief.md, design/              (existing)
│  └─ adr/                           decision records (0001-data-model, 0002-rls-strategy, …)
├─ embed/
│  └─ embed.ts                       vanilla TS, bundled by tsup to public/embed.js
├─ supabase/
│  ├─ config.toml                    local stack (supabase start)
│  └─ migrations/                    drizzle-kit output (prefix: "supabase") + custom SQL
├─ scripts/
│  └─ seed.ts                        Lumen Studio demo data (pnpm db:seed)
├─ tests/
│  ├─ unit/                          slot engine, reminder timing, codes, Result helpers
│  ├─ integration/                   RLS isolation, booking service vs a real local DB
│  └─ e2e/                           Playwright + axe
├─ src/
│  ├─ proxy.ts                       auth session refresh, protects /app and /onboarding
│  ├─ env.ts                         Zod-validated env (server + client split)
│  ├─ app/
│  │  ├─ (marketing)/page.tsx        landing
│  │  ├─ (auth)/sign-in/             magic link + Google
│  │  ├─ (auth)/auth/callback/       OAuth / magic-link code exchange
│  │  ├─ (auth)/onboarding/          4-step wizard + "You're live"
│  │  ├─ app/                        owner dashboard (protected)
│  │  │  ├─ layout.tsx               sidebar + top bar shell
│  │  │  ├─ today/  calendar/  bookings/  customers/[id]/
│  │  │  ├─ services/  staff/  ai/  insights/
│  │  │  └─ settings/                business · booking-page · embed · notifications · billing
│  │  ├─ b/[slug]/                   public booking flow + opengraph-image.tsx
│  │  ├─ m/[token]/                  manage booking (reschedule / cancel)
│  │  ├─ embed/[slug]/               iframe target for the widget
│  │  └─ api/
│  │     ├─ chat/[slug]/route.ts     AI receptionist (streaming)
│  │     ├─ webhooks/stripe/route.ts
│  │     └─ inngest/route.ts
│  ├─ components/
│  │  ├─ ui/                         shadcn/ui primitives (generated)
│  │  ├─ booking/  dashboard/  chat/  settings/  marketing/
│  │  └─ shared/                     status/source badges, empty states, skeletons, time display
│  ├─ emails/                        React Email templates
│  ├─ hooks/                         client hooks (realtime, media queries)
│  ├─ lib/                           client-safe pure helpers: result.ts, money.ts, dates.ts, cn
│  │  └─ supabase/browser.ts         browser client (auth + Realtime only, never tenant queries)
│  └─ server/                        server-only (import "server-only" in every entry)
│     ├─ db/
│     │  ├─ schema.ts                Drizzle schema (below)
│     │  ├─ client.ts                adminDb + withRls(user) (see §3)
│     │  └─ queries/                 tenant-scoped data access, one file per aggregate
│     ├─ booking/
│     │  ├─ slots.ts                 PURE slot engine, no DB
│     │  ├─ service.ts               the ONE booking write path
│     │  ├─ codes.ts  tokens.ts      booking codes; manage tokens (random, SHA-256 hashed)
│     │  └─ errors.ts                23P01 → SLOT_TAKEN, etc.
│     ├─ ai/                         model.ts (AI_PROVIDER/AI_MODEL), prompt.ts, tools.ts
│     ├─ auth/                       getSession, requireMember(businessId, role)
│     ├─ billing/                    stripe.ts, plans.ts (limits)
│     ├─ email/                      send.ts, ics.ts
│     ├─ jobs/                       inngest client + functions/
│     ├─ supabase/server.ts          server client (cookies)
│     └─ rate-limit.ts               Upstash limiters
├─ drizzle.config.ts  vitest.config.ts  playwright.config.ts
└─ CLAUDE.md
```

## 2. Drizzle schema (`src/server/db/schema.ts`)

```ts
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

// ── helpers ─────────────────────────────────────────────────────────────
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = tstz("created_at").defaultNow().notNull();
const updatedAt = tstz("updated_at").defaultNow().notNull().$onUpdate(() => new Date());
const businessId = () =>
  uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" });

// ── enums ───────────────────────────────────────────────────────────────
export const planEnum = pgEnum("plan", ["free", "pro"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "staff"]);
// Only the staff colours defined in docs/design/globals.css.
export const staffColorEnum = pgEnum("staff_color", ["teal", "violet", "pink"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending", "confirmed", "cancelled", "completed", "no_show",
]);
export const bookingSourceEnum = pgEnum("booking_source", ["page", "widget", "ai", "manual"]);
export const actorEnum = pgEnum("actor", ["customer", "staff", "ai", "system"]);
export const bookingEventTypeEnum = pgEnum("booking_event_type", [
  "created", "rescheduled", "cancelled", "completed", "no_show", "reminder_sent",
]);
export const chatChannelEnum = pgEnum("chat_channel", ["page", "widget"]);
export const chatOutcomeEnum = pgEnum("chat_outcome", ["open", "answered", "booked", "handed_off"]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", ["user", "assistant", "system"]);
export const handoffStatusEnum = pgEnum("handoff_status", ["open", "replied", "closed"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "incomplete", "incomplete_expired", "trialing", "active",
  "past_due", "canceled", "unpaid", "paused",
]);

// UI preferences only. Anything the slot engine or billing depends on is a real column.
export type BusinessSettings = {
  embed?: {
    buttonText: string; // ≤ 24 chars
    position: "bottom-right" | "bottom-left" | "inline";
    showChat: boolean;
  };
  notifications?: { ownerNewBookingEmail: boolean };
};

// ── tenant root ─────────────────────────────────────────────────────────
export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(), // IANA, validated with Zod + Intl
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    brandColor: text("brand_color").notNull().default("#0F766E"),
    logoUrl: text("logo_url"),
    address: text("address"),
    phone: text("phone"),
    contactEmail: text("contact_email"),
    // booking rules (read by the slot engine)
    minNoticeMin: integer("min_notice_min").notNull().default(120),
    maxDaysAhead: integer("max_days_ahead").notNull().default(60),
    slotIntervalMin: smallint("slot_interval_min").notNull().default(30),
    cancellationWindowHours: integer("cancellation_window_hours").notNull().default(24),
    // billing + AI
    plan: planEnum("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    aiMonthlyTokenBudget: integer("ai_monthly_token_budget").notNull().default(500_000),
    settings: jsonb("settings").$type<BusinessSettings>().notNull().default({}),
    isDemo: boolean("is_demo").notNull().default(false),
    onboardedAt: tstz("onboarded_at"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("businesses_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'`),
    check("businesses_brand_color_hex", sql`${t.brandColor} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("businesses_min_notice", sql`${t.minNoticeMin} >= 0`),
    check("businesses_max_days", sql`${t.maxDaysAhead} between 1 and 365`),
    check("businesses_slot_interval", sql`${t.slotIntervalMin} in (15, 30)`),
    check("businesses_cancel_window", sql`${t.cancellationWindowHours} >= 0`),
  ],
);

// ── people ──────────────────────────────────────────────────────────────
// One row per auth user (created by trigger on auth.users). Powers "Edited by Mia".
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  createdAt,
  updatedAt,
});

export const memberships = pgTable(
  "memberships",
  {
    businessId: businessId(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.businessId, t.userId] }), index().on(t.userId)],
);

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email"),
    title: text("title"), // "Senior stylist"
    color: staffColorEnum("color").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique("staff_id_business").on(t.id, t.businessId), // target for composite FKs
    unique("staff_business_user").on(t.businessId, t.userId),
  ],
);

export const staffInvites = pgTable(
  "staff_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    staffId: uuid("staff_id").notNull(),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("staff"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => authUsers.id, { onDelete: "set null" }),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    createdAt,
  },
  (t) => [
    foreignKey({ columns: [t.staffId, t.businessId], foreignColumns: [staff.id, staff.businessId] })
      .onDelete("cascade"),
  ],
);

// ── catalogue and availability ──────────────────────────────────────────
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    priceCents: integer("price_cents").notNull().default(0), // 0 = "Free"
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    active: boolean("active").notNull().default(true), // "Bookable online"
    archivedAt: tstz("archived_at"), // soft delete keeps booking history intact
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique("services_id_business").on(t.id, t.businessId),
    check("services_duration", sql`${t.durationMin} > 0 and ${t.durationMin} % 5 = 0`),
    check("services_price", sql`${t.priceCents} >= 0`),
    check("services_buffers", sql`${t.bufferBeforeMin} >= 0 and ${t.bufferAfterMin} >= 0`),
  ],
);

export const staffServices = pgTable(
  "staff_services",
  {
    businessId: businessId(),
    staffId: uuid("staff_id").notNull(),
    serviceId: uuid("service_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.serviceId] }),
    index().on(t.serviceId),
    foreignKey({ columns: [t.staffId, t.businessId], foreignColumns: [staff.id, staff.businessId] })
      .onDelete("cascade"),
    foreignKey({ columns: [t.serviceId, t.businessId], foreignColumns: [services.id, services.businessId] })
      .onDelete("cascade"),
  ],
);

// Local wall-clock times in the business timezone. Several rows per weekday allowed.
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    staffId: uuid("staff_id").notNull(),
    weekday: smallint("weekday").notNull(), // 0 = Sunday … 6 = Saturday (JS getDay)
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    index().on(t.staffId, t.weekday),
    check("availability_weekday", sql`${t.weekday} between 0 and 6`),
    check("availability_range", sql`${t.startTime} < ${t.endTime}`),
    foreignKey({ columns: [t.staffId, t.businessId], foreignColumns: [staff.id, staff.businessId] })
      .onDelete("cascade"),
  ],
);

export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    staffId: uuid("staff_id").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    allDay: boolean("all_day").notNull().default(false), // display hint; range is authoritative
    reason: text("reason"),
    createdAt,
  },
  (t) => [
    index().on(t.staffId, t.startsAt),
    check("time_off_range", sql`${t.endsAt} > ${t.startsAt}`),
    foreignKey({ columns: [t.staffId, t.businessId], foreignColumns: [staff.id, staff.businessId] })
      .onDelete("cascade"),
  ],
);

// ── customers and bookings ──────────────────────────────────────────────
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    timezone: text("timezone"), // last seen, for emails
    notes: text("notes"), // private: never sent to the customer or the AI
    notesUpdatedAt: tstz("notes_updated_at"),
    notesUpdatedBy: uuid("notes_updated_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique("customers_id_business").on(t.id, t.businessId),
    uniqueIndex("customers_business_email").on(t.businessId, sql`lower(${t.email})`),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    code: text("code").notNull(), // "SW-8K3D-27"
    serviceId: uuid("service_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    bufferedStart: tstz("buffered_start").notNull(),
    bufferedEnd: tstz("buffered_end").notNull(),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    source: bookingSourceEnum("source").notNull(),
    priceCents: integer("price_cents").notNull(), // snapshot at booking time
    customerNotes: text("customer_notes"),
    customerTimezone: text("customer_timezone"),
    manageTokenHash: text("manage_token_hash").notNull().unique(),
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    aiConversationId: uuid("ai_conversation_id").references((): AnyPgColumn => aiConversations.id, {
      onDelete: "set null",
    }),
    cancelledAt: tstz("cancelled_at"),
    cancelledBy: actorEnum("cancelled_by"),
    cancelReason: text("cancel_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique("bookings_business_code").on(t.businessId, t.code),
    index().on(t.businessId, t.startsAt),
    index().on(t.staffId, t.startsAt),
    index().on(t.customerId),
    check("bookings_range", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "bookings_buffers",
      sql`${t.bufferedStart} <= ${t.startsAt} and ${t.bufferedEnd} >= ${t.endsAt}`,
    ),
    foreignKey({ columns: [t.serviceId, t.businessId], foreignColumns: [services.id, services.businessId] }),
    foreignKey({ columns: [t.staffId, t.businessId], foreignColumns: [staff.id, staff.businessId] }),
    foreignKey({ columns: [t.customerId, t.businessId], foreignColumns: [customers.id, customers.businessId] }),
    // no_double_booking EXCLUDE constraint lives in a custom SQL migration (drizzle can't express it)
  ],
);

// Audit trail: drawer timeline, AI transcript rows, "who cancelled this?"
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    type: bookingEventTypeEnum("type").notNull(),
    actor: actorEnum("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>(), // e.g. { from: {startsAt}, to: {startsAt} }
    createdAt,
  },
  (t) => [index().on(t.bookingId, t.createdAt)],
);

// ── AI receptionist ─────────────────────────────────────────────────────
export const faqs = pgTable(
  "faqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [index().on(t.businessId, t.sortOrder)],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    visitorName: text("visitor_name"), // "Visitor" when unknown
    visitorEmail: text("visitor_email"),
    channel: chatChannelEnum("channel").notNull(),
    outcome: chatOutcomeEnum("outcome").notNull().default("open"),
    startedAt: tstz("started_at").defaultNow().notNull(),
    lastMessageAt: tstz("last_message_at").defaultNow().notNull(),
  },
  (t) => [index().on(t.businessId, t.lastMessageAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    content: text("content").notNull().default(""), // plain text, for previews and search
    parts: jsonb("parts").$type<unknown[]>().notNull().default([]), // AI SDK UIMessage parts incl. tool calls + results
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt,
  },
  (t) => [index().on(t.conversationId, t.createdAt), index().on(t.businessId, t.createdAt)],
);

// "Question for the team"
export const handoffRequests = pgTable(
  "handoff_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    conversationId: uuid("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    status: handoffStatusEnum("status").notNull().default("open"),
    repliedAt: tstz("replied_at"),
    repliedBy: uuid("replied_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [index().on(t.businessId, t.status, t.createdAt)],
);

// ── billing ─────────────────────────────────────────────────────────────
export const subscriptions = pgTable("subscriptions", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripePriceId: text("stripe_price_id").notNull(),
  status: subscriptionStatusEnum("status").notNull(),
  currentPeriodEnd: tstz("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt,
});

// Webhook idempotency (not tenant data; service role only)
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // evt_…
  type: text("type").notNull(),
  receivedAt: tstz("received_at").defaultNow().notNull(),
});
```

### Custom SQL migration (alongside the generated one)

```sql
create extension if not exists btree_gist;

alter table bookings add constraint no_double_booking
  exclude using gist (
    staff_id with =,
    tstzrange(buffered_start, buffered_end, '[)') with &&
  ) where (status in ('pending', 'confirmed'));

-- deny by default: RLS on for every table now, policies added in Phase 1 step 6
alter table businesses enable row level security;
-- … one line per table …

-- profiles row for every new auth user
create function public.handle_new_user() returns trigger … ;
create trigger on_auth_user_created after insert on auth.users …;
```

Invoices are not stored: the billing page reads them from Stripe.

## 3. How RLS and the data-access layer fit together

Drizzle connects over a direct Postgres URL as the `postgres` role, which **bypasses RLS**. So `src/server/db/client.ts` exports two entry points:

- `withRls(session, fn)` runs `fn` in a transaction that first does `set local role authenticated` and `set_config('request.jwt.claims', …)`, so `auth.uid()` and the policies apply. Every dashboard query in `queries/` goes through this, **and** still filters by `business_id` explicitly (two layers of protection, as the rules ask).
- `adminDb` (RLS bypassed) only for paths with no signed-in user: the public booking page, manage links, the AI chat, Stripe webhooks and Inngest jobs. Those `queries/` functions take a `businessId` resolved from the slug or token and scope everything by it.

The RLS isolation test (Phase 1) exercises `withRls` with two users from two businesses.

## 4. Approval notes

### Staff colours

New staff get `teal`, `violet`, `pink` in order (`staff index mod 3`), so colours repeat from the fourth person on. A colour is never the only way to identify someone: the staff name is always shown next to it (calendar blocks, chips, timeline rows, legends).

- [ ] TODO: extend the staff palette in `docs/design/globals.css` (with light and dark `-soft` / `-text` variants that meet AA) and add the values to `staff_color`.

### adminDb guardrails

- Every query function that uses `adminDb` takes `businessId: string` as a required argument, enforced by its type signature. No `adminDb` query function exists without one. (The only exceptions are the lookups that *resolve* a tenant: by slug, by manage-token hash, and Stripe customer ID. Each returns only the ID plus public fields.)
- Public query functions (booking page, embed, AI chat) select explicit public columns. They never return customer emails, phone numbers, private notes, token hashes, Stripe IDs or settings that aren't meant for customers. Their return types are named `Public…` types.
- Test: `tests/integration/public-data.test.ts` loads the public booking page data for the seeded business and fails if any private field name or seeded private value (customer emails, notes, `manage_token_hash`, `stripe_customer_id`) appears anywhere in the serialized result.

### Confirmed

- The custom SQL migration runs `create extension if not exists btree_gist` and adds `no_double_booking`: `exclude using gist (staff_id with =, tstzrange(buffered_start, buffered_end, '[)') with &&) where (status in ('pending', 'confirmed'))`. It's added in step 2 so the constraint exists from the first migration, with a test that two overlapping confirmed bookings for one staff member fail with `23P01`.
- The tenant-isolation test goes through `withRls` (the dashboard path), not `adminDb`: a member of business A gets zero rows when reading business B's tables and is refused when inserting, updating or deleting B's rows.
