CREATE TYPE "public"."ai_proposal_kind" AS ENUM('book', 'reschedule', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_state" AS ENUM('open', 'confirming', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" "ai_proposal_kind" NOT NULL,
	"state" "ai_proposal_state" DEFAULT 'open' NOT NULL,
	"booking_id" uuid,
	"service_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"any_staff" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"price_cents" integer NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"customer_timezone" text,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposals_range" CHECK ("ai_proposals"."ends_at" > "ai_proposals"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_conversation_id_business_id_ai_conversations_id_business_id_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."ai_conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_booking_id_business_id_bookings_id_business_id_fk" FOREIGN KEY ("booking_id","business_id") REFERENCES "public"."bookings"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_service_id_business_id_services_id_business_id_fk" FOREIGN KEY ("service_id","business_id") REFERENCES "public"."services"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_staff_id_business_id_staff_id_business_id_fk" FOREIGN KEY ("staff_id","business_id") REFERENCES "public"."staff"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_proposals_business_id_conversation_id_index" ON "ai_proposals" USING btree ("business_id","conversation_id");