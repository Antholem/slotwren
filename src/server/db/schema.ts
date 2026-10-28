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

/*
 * Slotwren data model. Every tenant table carries business_id, and child rows
 * reference their parents with composite (id, business_id) foreign keys so a row
 * can never point at another tenant's data.
 *
 * Things drizzle can't express (the no_double_booking exclusion constraint,
 * RLS, the auth.users trigger) live in custom SQL migrations in supabase/migrations.
 */

// ── helpers ─────────────────────────────────────────────────────────────
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").defaultNow().notNull();
const updatedAt = () =>
  tstz("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
const businessId = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" });

// ── enums ───────────────────────────────────────────────────────────────
export const planEnum = pgEnum("plan", ["free", "pro"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "staff"]);
// Only the staff colours defined in docs/design/globals.css. New staff cycle
// through them in order (index mod 3); the name is always shown with the colour.
export const staffColorEnum = pgEnum("staff_color", ["teal", "violet", "pink"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);
export const bookingSourceEnum = pgEnum("booking_source", ["page", "widget", "ai", "manual"]);
export const actorEnum = pgEnum("actor", ["customer", "staff", "ai", "system"]);
export const bookingEventTypeEnum = pgEnum("booking_event_type", [
  "created",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
  "reminder_sent",
]);
export const chatChannelEnum = pgEnum("chat_channel", ["page", "widget"]);
export const chatOutcomeEnum = pgEnum("chat_outcome", ["open", "answered", "booked", "handed_off"]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", ["user", "assistant", "system"]);
export const handoffStatusEnum = pgEnum("handoff_status", ["open", "replied", "closed"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

export const STAFF_COLORS = staffColorEnum.enumValues;
export type StaffColor = (typeof STAFF_COLORS)[number];

/** Colour for the nth staff member (0-based): teal, violet, pink, teal, … */
export function staffColorFor(index: number): StaffColor {
  return STAFF_COLORS[index % STAFF_COLORS.length]!;
}

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
// One row per auth user (created by a trigger on auth.users). Powers "Edited by Mia".
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    businessId: businessId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    createdAt: createdAt(),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.staffId, t.businessId],
      foreignColumns: [staff.id, staff.businessId],
    }).onDelete("cascade"),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    foreignKey({
      columns: [t.staffId, t.businessId],
      foreignColumns: [staff.id, staff.businessId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.serviceId, t.businessId],
      foreignColumns: [services.id, services.businessId],
    }).onDelete("cascade"),
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
    foreignKey({
      columns: [t.staffId, t.businessId],
      foreignColumns: [staff.id, staff.businessId],
    }).onDelete("cascade"),
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
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.staffId, t.startsAt),
    check("time_off_range", sql`${t.endsAt} > ${t.startsAt}`),
    foreignKey({
      columns: [t.staffId, t.businessId],
      foreignColumns: [staff.id, staff.businessId],
    }).onDelete("cascade"),
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
    notesUpdatedBy: uuid("notes_updated_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    aiConversationId: uuid("ai_conversation_id").references((): AnyPgColumn => aiConversations.id, {
      onDelete: "set null",
    }),
    cancelledAt: tstz("cancelled_at"),
    cancelledBy: actorEnum("cancelled_by"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    foreignKey({
      columns: [t.serviceId, t.businessId],
      foreignColumns: [services.id, services.businessId],
    }),
    foreignKey({
      columns: [t.staffId, t.businessId],
      foreignColumns: [staff.id, staff.businessId],
    }),
    foreignKey({
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }),
    // no_double_booking EXCLUDE constraint: see the custom SQL migration.
  ],
);

// Audit trail: drawer timeline, AI transcript rows, "who cancelled this?"
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    type: bookingEventTypeEnum("type").notNull(),
    actor: actorEnum("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>(), // e.g. { from: { startsAt }, to: { startsAt } }
    createdAt: createdAt(),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.businessId, t.sortOrder)],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    visitorName: text("visitor_name"), // shown as "Visitor" when unknown
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
    parts: jsonb("parts").$type<unknown[]>().notNull().default([]), // AI SDK message parts incl. tool calls + results
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.conversationId, t.createdAt), index().on(t.businessId, t.createdAt)],
);

// "Question for the team"
export const handoffRequests = pgTable(
  "handoff_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessId(),
    conversationId: uuid("conversation_id").references(() => aiConversations.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    status: handoffStatusEnum("status").notNull().default("open"),
    repliedAt: tstz("replied_at"),
    repliedBy: uuid("replied_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
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
  updatedAt: updatedAt(),
});

// Webhook idempotency. Not tenant data; service role only.
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // evt_…
  type: text("type").notNull(),
  receivedAt: tstz("received_at").defaultNow().notNull(),
});
