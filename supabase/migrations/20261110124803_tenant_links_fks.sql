ALTER TABLE "ai_conversations" DROP CONSTRAINT "ai_conversations_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_messages" DROP CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_booking_id_bookings_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_ai_conversation_id_ai_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "handoff_requests" DROP CONSTRAINT "handoff_requests_conversation_id_ai_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "handoff_requests" DROP CONSTRAINT "handoff_requests_customer_id_customers_id_fk";
--> statement-breakpoint
-- Targets first: a composite FK needs a unique key on (id, business_id).
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_id_business" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_id_business" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_business_id_ai_conversations_id_business_id_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."ai_conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_business_id_bookings_id_business_id_fk" FOREIGN KEY ("booking_id","business_id") REFERENCES "public"."bookings"("id","business_id") ON DELETE cascade ON UPDATE no action;
