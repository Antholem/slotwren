-- Staff invites (Phase 1, step 1.8). See docs/adr/0002-rls-strategy.md:
-- users can't insert memberships, so accepting an invite goes through this
-- SECURITY DEFINER function, which checks the token itself.

-- One pending invite per staff member: resending rotates its token.
create unique index staff_invites_one_pending
  on public.staff_invites (staff_id)
  where accepted_at is null;
--> statement-breakpoint

/*
 * Accept the invite whose raw token is p_token, as the signed-in user.
 * Returns {"outcome": …, "business_id": …}. Outcomes:
 *   accepted        membership (role staff) created, staff row linked and
 *                   switched on, invite marked used
 *   already_member  the user already belongs to that business (invite used)
 *   invalid         no such invite (wrong, revoked or replaced by a resend)
 *   used            already accepted
 *   expired         past expires_at
 *   wrong_account   signed in with a different email from the invite's
 *   not_signed_in   no auth.uid()
 * The token is hashed here exactly as src/server/booking/tokens.ts hashes it
 * (SHA-256, hex), so the raw token never has to be stored or compared.
 */
create function private.accept_staff_invite(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
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
revoke all on function private.accept_staff_invite(text) from public, anon;
--> statement-breakpoint
grant execute on function private.accept_staff_invite(text) to authenticated;
