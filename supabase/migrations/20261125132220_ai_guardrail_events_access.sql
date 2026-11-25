-- AI receptionist guardrail events (step 4.6): written by the server
-- (adminDb: the chat and hand-off routes), read by the business's members on
-- /app/ai. Nobody signed in may write or change them.
alter table public.ai_guardrail_events enable row level security;
--> statement-breakpoint
revoke insert, update, delete on public.ai_guardrail_events from authenticated;
--> statement-breakpoint
create policy ai_guardrail_events_select on public.ai_guardrail_events
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
