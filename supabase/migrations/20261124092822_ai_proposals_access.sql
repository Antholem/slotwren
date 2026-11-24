-- AI receptionist proposals (src/server/db/schema.ts, aiProposals): what the
-- model proposed, waiting for the customer's Confirm. Server only, like
-- manage_tokens and stripe_events: RLS on, no policies, no privileges for anon
-- or authenticated. The chat route and the confirm route (adminDb) are the
-- only readers and writers; owners see proposals through the transcript.
alter table public.ai_proposals enable row level security;
--> statement-breakpoint
revoke all on public.ai_proposals from anon, authenticated;
