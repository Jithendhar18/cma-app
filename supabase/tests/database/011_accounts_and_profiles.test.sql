-- M3: new accounts get a profile and settings; users edit only what they should.
begin;
select plan(32);

-- Profile creation by trigger --------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.invalid', '{"display_name":"  FAKE Alice  "}'),
  ('22222222-2222-4222-8222-222222222222', 'bob.smith@example.invalid', '{}'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.invalid', '{"display_name":"   "}'),
  ('44444444-4444-4444-8444-444444444444', null, null),
  ('55555555-5555-4555-8555-555555555555', 'dave@example.invalid', jsonb_build_object('display_name', repeat('x', 200)));

select is((select count(*)::int from public.profiles), 5, 'a profile was created for each new auth user');
select is((select count(*)::int from public.user_settings), 5, 'and a settings row');
select is((select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'FAKE Alice', 'display name comes from sign-up metadata, trimmed');
select is((select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'bob.smith', 'no metadata: falls back to the email prefix');
select is((select display_name from public.profiles where id = '33333333-3333-4333-8333-333333333333'), 'carol', 'blank metadata: falls back to the email prefix');
select is((select display_name from public.profiles where id = '44444444-4444-4444-8444-444444444444'), 'Student', 'no email and no metadata: a neutral default');
select is((select char_length(display_name) from public.profiles where id = '55555555-5555-4555-8555-555555555555'), 80, 'an over-long display name is cut to 80 characters');
select is(
  (select count(*)::int from public.user_settings where user_id = '11111111-1111-4111-8111-111111111111'
      and daily_target_hours = 8 and weekly_target_hours = 50 and pomodoro_focus_minutes = 50 and short_break_minutes = 10
      and long_break_minutes = 20 and long_break_every = 4 and theme = 'dark'
      and study_start_time = '06:00' and study_end_time = '23:00'),
  1, 'settings start with the app''s existing defaults');
select is((select time_zone from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'Asia/Kolkata', 'time zone defaults to Asia/Kolkata');

-- What a signed-in user can and cannot do to a profile ----------------------------------------------------------------
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')$$), '42501', 'a client cannot insert a profile');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$delete from public.profiles$$), '42501', 'a client cannot delete a profile');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set display_name = 'FAKE Alice Renamed' where id = '11111111-1111-4111-8111-111111111111'$$), 'OK', 'a user can rename themselves');
select is((select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'FAKE Alice Renamed', 'and the change is stored');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set display_name = 'HACKED' where id = '22222222-2222-4222-8222-222222222222'$$), 'OK', 'updating someone else''s profile is silently a no-op ...');
select is((select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'bob.smith', '... and changes nothing');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set id = gen_random_uuid() where id = '11111111-1111-4111-8111-111111111111'$$), '42501', 'the profile id cannot be changed (no column grant)');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set created_at = now() where id = '11111111-1111-4111-8111-111111111111'$$), '42501', 'created_at is not client-editable');
select is(tests.value_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'), 'select count(*) from public.profiles'), '1', 'a user sees only their own profile');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.profiles'), 'ERR:42501', 'anon cannot read profiles');

-- Profile validation -------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set display_name = '' where id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'an empty display name is rejected');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set avatar_data_url = 'https://example.invalid/a.png' where id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'an avatar must be an image data URL, not a link');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set avatar_data_url = 'data:text/html;base64,AAAA' where id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'an avatar cannot be HTML or script');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set avatar_data_url = 'data:image/jpeg;base64,' || repeat('A', 200001) where id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'an oversized avatar is rejected');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set avatar_data_url = 'data:image/png;base64,AAAA' where id = '11111111-1111-4111-8111-111111111111'$$), 'OK', 'a small image data URL is accepted');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.profiles set time_zone = 'Not A Zone!' where id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'a malformed time zone is rejected');

-- Settings -------------------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.user_settings set daily_target_hours = 6, theme = 'light' where user_id = '11111111-1111-4111-8111-111111111111'$$), 'OK', 'a user can change their own settings');
select is((select theme from public.user_settings where user_id = '11111111-1111-4111-8111-111111111111'), 'light', 'and it is stored');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.user_settings set daily_target_hours = 0 where user_id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'a daily target of 0 is rejected');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.user_settings set study_start_time = '22:00', study_end_time = '08:00' where user_id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'a study window that ends before it starts is rejected');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.user_settings set theme = 'neon' where user_id = '11111111-1111-4111-8111-111111111111'$$), '23514', 'an unknown theme is rejected');
select is(tests.dml_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'),
  $$update public.user_settings set user_id = '22222222-2222-4222-8222-222222222222' where user_id = '11111111-1111-4111-8111-111111111111'$$), '42501', 'settings cannot be handed to another user');
select is(tests.value_as('authenticated', tests.claims('11111111-1111-4111-8111-111111111111'), 'select count(*) from public.user_settings'), '1', 'a user sees only their own settings');

select * from finish();
rollback;
