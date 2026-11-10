-- Phase 1 review, batch 1 (docs/adr/0002-rls-strategy.md).

-- ── Tenant links Drizzle can't express ──────────────────────────────────
-- Composite FKs keep a link inside one business. These clear only the link
-- column when the target goes (ON DELETE SET NULL (col), Postgres 15+), never
-- business_id, which is NOT NULL.
alter table public.bookings
  add constraint bookings_ai_conversation_business_fk
  foreign key (ai_conversation_id, business_id)
  references public.ai_conversations (id, business_id)
  on delete set null (ai_conversation_id);
--> statement-breakpoint
alter table public.ai_conversations
  add constraint ai_conversations_customer_business_fk
  foreign key (customer_id, business_id)
  references public.customers (id, business_id)
  on delete set null (customer_id);
--> statement-breakpoint
alter table public.handoff_requests
  add constraint handoff_requests_conversation_business_fk
  foreign key (conversation_id, business_id)
  references public.ai_conversations (id, business_id)
  on delete set null (conversation_id);
--> statement-breakpoint
alter table public.handoff_requests
  add constraint handoff_requests_customer_business_fk
  foreign key (customer_id, business_id)
  references public.customers (id, business_id)
  on delete set null (customer_id);
