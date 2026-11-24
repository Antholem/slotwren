-- Questions for the team (handoff_requests): any member reads them, only
-- owners mark them answered (step 4.5). The chat creates them (adminDb).
drop policy handoff_requests_update on public.handoff_requests;
--> statement-breakpoint
create policy handoff_requests_owner_update on public.handoff_requests
  for update to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint
-- Answering changes the status and who/when only.
revoke update on public.handoff_requests from authenticated;
--> statement-breakpoint
grant update (status, replied_at, replied_by) on public.handoff_requests to authenticated;
