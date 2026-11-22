-- Customers' private notes (step 3.6, docs/adr/0002-rls-strategy.md).
--
-- The whole team reads and updates customers (bookings fill in a phone or a
-- timezone), but only owners write the private notes. Column grants can't
-- tell owners from staff, so a trigger guards the notes, like the booking
-- price. It also stamps who edited them and when from the session, so the
-- "Edited by Mia, 12 Sep" line can't be forged. Server paths without a user
-- (seed, jobs) run as adminDb and set the stamp themselves.
create function private.guard_customer_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed boolean;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    changed := new.notes is not null;
  else
    changed := new.notes is distinct from old.notes;
  end if;

  if changed then
    if not exists (
      select 1 from private.owner_business_ids() as owned(id) where owned.id = new.business_id
    ) then
      raise exception 'Only owners can change a customer''s private notes'
        using errcode = '42501';
    end if;
    new.notes_updated_by := (select auth.uid());
    new.notes_updated_at := now();
  elsif tg_op = 'UPDATE' then
    -- Nobody rewrites who last edited the notes without editing them.
    new.notes_updated_by := old.notes_updated_by;
    new.notes_updated_at := old.notes_updated_at;
  else
    new.notes_updated_by := null;
    new.notes_updated_at := null;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger customers_guard_notes
  before insert or update on public.customers
  for each row execute function private.guard_customer_notes();
