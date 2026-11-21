CREATE TYPE "public"."manage_token_purpose" AS ENUM('created', 'rescheduled', 'reminder');--> statement-breakpoint
CREATE TABLE "manage_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "manage_token_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manage_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "manage_tokens" ADD CONSTRAINT "manage_tokens_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manage_tokens" ADD CONSTRAINT "manage_tokens_booking_id_business_id_bookings_id_business_id_fk" FOREIGN KEY ("booking_id","business_id") REFERENCES "public"."bookings"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manage_tokens_booking_id_index" ON "manage_tokens" USING btree ("booking_id");