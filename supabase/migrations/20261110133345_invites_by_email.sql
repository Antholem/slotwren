-- Invites across devices (Phase 1 review). Someone who opens the sign-in email
-- on another device loses the invite link they started from. They can still
-- see and accept invites sent to their own (verified) email address, without
-- the token. See docs/adr/0002-rls-strategy.md.

/*
 * The checks and writes shared by both ways of accepting, for an invite row
 * already locked FOR UPDATE by the caller. Not callable by users.
 */
create function private.claim_staff_invite(v_invite public.staff_invites, v_uid uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if v_invite.accepted_at is not null then
    return jsonb_build_object('outcome', 'used', 'business_id', v_invite.business_id);
  end if;
  if v_invite.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired', 'business_id', v_invite.business_id);
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null or lower(v_email) <> lower(v_invite.email) then
    return jsonb_build_object('outcome', 'wrong_account', 'business_id', v_invite.business_id);
  end if;

  if exists (
    select 1 from public.memberships
    where business_id = v_invite.business_id and user_id = v_uid
  ) then
    update public.staff_invites set accepted_at = now() where id = v_invite.id;
    return jsonb_build_object('outcome', 'already_member', 'business_id', v_invite.business_id);
  end if;

  -- The staff row must still be free to claim (not linked to someone else).
  if exists (
    select 1 from public.staff
    where id = v_invite.staff_id and business_id = v_invite.business_id
      and user_id is not null and user_id <> v_uid
  ) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Always staff: owners are made by creating a business, not by invite.
  insert into public.memberships (business_id, user_id, role)
  values (v_invite.business_id, v_uid, 'staff');

  update public.staff
  set user_id = v_uid,
      active = true,
      email = coalesce(email, v_invite.email),
      updated_at = now()
  where id = v_invite.staff_id and business_id = v_invite.business_id;

  update public.staff_invites set accepted_at = now() where id = v_invite.id;

  return jsonb_build_object('outcome', 'accepted', 'business_id', v_invite.business_id);
end;
$$;
--> statement-breakpoint
revoke all on function private.claim_staff_invite(public.staff_invites, uuid) from public, anon, authenticated;
--> statement-breakpoint

-- Same behaviour as before (see 20261106132152_accept_staff_invite.sql), now
-- sharing claim_staff_invite.
create or replace function private.accept_staff_invite(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.staff_invites%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'not_signed_in');
  end if;

  select * into v_invite
  from public.staff_invites
  where token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  return private.claim_staff_invite(v_invite, v_uid);
end;
$$;
--> statement-breakpoint

/*
 * Accept an invite by id, without its token. Only works for invites sent to
 * the signed-in user's own email (claim_staff_invite checks it), so an id
 * alone is worth nothing to anyone else.
 */
create function private.accept_my_staff_invite(p_invite_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.staff_invites%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'not_signed_in');
  end if;

  select * into v_invite from public.staff_invites where id = p_invite_id for update;
  if not found then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  return private.claim_staff_invite(v_invite, v_uid);
end;
$$;
--> statement-breakpoint
revoke all on function private.accept_my_staff_invite(uuid) from public, anon;
--> statement-breakpoint
grant execute on function private.accept_my_staff_invite(uuid) to authenticated;
--> statement-breakpoint

/*
 * Pending, unexpired invites sent to the signed-in user's own email, with
 * what the "You've been invited" page shows. Nothing about other people.
 */
create function private.my_pending_invites()
returns table (
  invite_id uuid,
  business_name text,
  logo_url text,
  staff_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, b.name, b.logo_url, s.name, i.expires_at
  from public.staff_invites i
  join public.businesses b on b.id = i.business_id
  join public.staff s on s.id = i.staff_id and s.business_id = i.business_id
  join auth.users u on u.id = (select auth.uid())
  where i.accepted_at is null
    and i.expires_at > now()
    and lower(i.email) = lower(u.email)
  order by i.sent_at desc
$$;
--> statement-breakpoint
revoke all on function private.my_pending_invites() from public, anon;
--> statement-breakpoint
grant execute on function private.my_pending_invites() to authenticated;
