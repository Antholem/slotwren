CREATE TYPE "public"."ai_guardrail_kind" AS ENUM('budget_warning', 'budget_exhausted', 'global_cap', 'provider_limited', 'handoff_limited', 'honeypot');--> statement-breakpoint
CREATE TABLE "ai_guardrail_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "ai_guardrail_kind" NOT NULL,
	"period" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_guardrail_events" ADD CONSTRAINT "ai_guardrail_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_guardrail_events_business_id_created_at_index" ON "ai_guardrail_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_guardrail_events_once" ON "ai_guardrail_events" USING btree ("business_id","kind","period") WHERE "ai_guardrail_events"."period" is not null;