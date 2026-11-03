-- Onboarding wizard (Phase 1, steps 1.4–1.6).

-- ── Progress ────────────────────────────────────────────────────────────
-- Owners advance setup_step as they finish wizard steps (the update policy
-- already limits writes to owners).
grant update (setup_step) on public.businesses to authenticated;
--> statement-breakpoint

-- ── Slug availability ───────────────────────────────────────────────────
-- RLS hides other tenants' businesses, so a signed-in owner can't see whether
-- a slug is taken. This answers only yes/no, never which business has it.
create function private.is_slug_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.businesses where slug = candidate)
$$;
--> statement-breakpoint
revoke all on function private.is_slug_available(text) from public, anon;
--> statement-breakpoint
grant execute on function private.is_slug_available(text) to authenticated;
--> statement-breakpoint

-- ── Logo storage ────────────────────────────────────────────────────────
-- Public bucket: logos appear on public booking pages and emails. Objects live
-- at <business_id>/<file>; only that business's owners can write there. Size
-- and type limits are enforced by Storage itself, not just the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'logos',
  'logos',
  true,
  2097152, -- 2 MiB
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint

create policy logos_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select id::text from private.owner_business_ids() as id
    )
  );
--> statement-breakpoint
create policy logos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select id::text from private.owner_business_ids() as id
    )
  );
--> statement-breakpoint
create policy logos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select id::text from private.owner_business_ids() as id
    )
  )
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select id::text from private.owner_business_ids() as id
    )
  );
--> statement-breakpoint
create policy logos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select id::text from private.owner_business_ids() as id
    )
  );
