-- RLS doesn't apply to TRUNCATE, and nothing in the app needs TRIGGER or
-- REFERENCES. 20261103094624_rls_policies revoked them on the tables that
-- existed then; ai_guardrail_events came later and got Supabase's default
-- grants. Revoke them here, and change the defaults so tables created from now
-- on never get them (tests/integration/rls-coverage.test.ts checks every table).
revoke truncate, trigger, references on public.ai_guardrail_events from anon, authenticated;
--> statement-breakpoint
-- Migrations run as postgres: its defaults.
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
