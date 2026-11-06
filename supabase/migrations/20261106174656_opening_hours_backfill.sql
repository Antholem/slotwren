-- Opening hours (Phase 1, step 1.9) live in businesses.settings.openingHours:
-- local "HH:MM" ranges per weekday, used for display and a soft check on staff
-- hours. Until now onboarding's "When are you open?" only saved the owner's
-- staff hours, so copy those for businesses that are already live.
update public.businesses b
set settings = b.settings || jsonb_build_object(
  'openingHours',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'weekday', ar.weekday,
          'start', to_char(ar.start_time, 'HH24:MI'),
          'end', to_char(ar.end_time, 'HH24:MI')
        )
        order by ar.weekday, ar.start_time
      )
      from public.availability_rules ar
      join public.staff s on s.id = ar.staff_id and s.business_id = ar.business_id
      join public.memberships m
        on m.business_id = s.business_id and m.user_id = s.user_id and m.role = 'owner'
      where ar.business_id = b.id
    ),
    '[]'::jsonb
  )
)
where b.onboarded_at is not null
  and not (b.settings ? 'openingHours');
