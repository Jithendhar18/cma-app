-- M3: the personal tables have the structure the design requires.
begin;
select plan(51);

-- All 11 personal tables exist, and every one has row level security on.
select has_table('public', t, 'table exists: ' || t)
  from unnest(array['profiles', 'user_settings', 'student_enrollments', 'enrollment_groups', 'chapter_progress',
                    'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests', 'local_import_runs']) as t;
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
      and c.relname in ('profiles', 'user_settings', 'student_enrollments', 'enrollment_groups', 'chapter_progress',
                        'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests', 'local_import_runs')),
  0, 'RLS is enabled on every personal table');

-- Isolation layer 2: composite keys tie every record to its owner's enrolment AND to the same syllabus.
select fk_ok('public', t, array['enrollment_id', 'user_id', 'csv_id'], 'public', 'student_enrollments', array['id', 'user_id', 'csv_id'],
             t || ': enrolment must belong to the same user and syllabus')
  from unnest(array['chapter_progress', 'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests', 'enrollment_groups']) as t;
select fk_ok('public', t, array['chapter_id', 'csv_id'], 'public', 'chapters', array['id', 'csv_id'],
             t || ': chapter must be in the enrolment''s syllabus')
  from unnest(array['chapter_progress', 'planner_sessions', 'study_sessions', 'revisions', 'practice_records']) as t;
select fk_ok('public', 'mock_tests', array['subject_id', 'csv_id'], 'public', 'subjects', array['id', 'csv_id'], 'mock_tests: paper in the enrolment''s syllabus');
select fk_ok('public', 'enrollment_groups', array['subject_group_id', 'csv_id'], 'public', 'subject_groups', array['id', 'csv_id'], 'enrollment_groups: group in the same syllabus');
select fk_ok('public', 'student_enrollments', array['csv_id', 'exam_attempt_id'], 'public', 'course_attempt_availability', array['csv_id', 'exam_attempt_id'], 'enrolment only for a supported combination');
select fk_ok('public', 'study_sessions', array['planner_session_id', 'enrollment_id', 'user_id'], 'public', 'planner_sessions', array['id', 'enrollment_id', 'user_id'],
             'a focus record can only credit a planned session of the same user and enrolment');
select fk_ok('public', 'local_import_runs', array['enrollment_id', 'user_id'], 'public', 'student_enrollments', array['id', 'user_id'], 'import log tied to the owner''s enrolment');

-- Lifecycle: personal data cascades from the account; curriculum is only ever restricted.
select is(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and (select relname from pg_class where oid = c.confrelid) in ('chapters', 'subjects', 'subject_groups', 'course_attempt_availability')
      and (select relname from pg_class where oid = c.conrelid) not in ('subjects', 'subject_groups', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources', 'course_attempt_availability')
      and c.confdeltype <> 'r'),
  0, 'every personal reference to curriculum is ON DELETE RESTRICT');
select is(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.confrelid = 'public.student_enrollments'::regclass and c.confdeltype <> 'c'),
  0, 'everything under an enrolment cascades with it');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.student_enrollments'::regclass and contype = 'f' and confrelid = 'public.profiles'::regclass),
  'c', 'enrolments cascade from the profile');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'f'),
  'c', 'the profile cascades from the auth user');

-- Idempotency keys and one-active rules.
select col_is_unique('public', t, array['user_id', 'client_id'], t || ': (user_id, client_id) unique')
  from unnest(array['planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests']) as t;
select col_is_unique('public', 'chapter_progress', array['enrollment_id', 'chapter_id'], 'one progress row per enrolment and chapter');
select col_is_unique('public', 'local_import_runs', array['user_id', 'source_sha256'], 'a backup file imports once per user');
select has_index('public', 'student_enrollments', 'student_enrollments_one_active', 'one active enrolment per user');
select has_index('public', 'revisions', 'revisions_one_pending', 'one pending revision per chapter');
select has_index('public', 'revisions', 'revisions_one_live_number', 'one live revision per number');

-- Guards, triggers and the new-user trigger.
select has_trigger('public', 'study_sessions', 'study_sessions_immutable', 'study_sessions: owner and keys are immutable');
select has_trigger('public', 'student_enrollments', 'student_enrollments_selectable', 'enrolment: attempt must be enabled');
select has_trigger('public', 'student_enrollments', 'student_enrollments_has_group', 'enrolment: an active one needs a group');
select has_trigger('auth', 'users', 'on_auth_user_created', 'new auth users get a profile automatically');

-- Views obey the caller's row level security.
select is(
  (select count(*)::int from pg_class
    where relnamespace = 'public'::regnamespace and relname in ('chapter_stats', 'daily_study_minutes', 'enrollment_options')
      and coalesce(reloptions, array[]::text[]) @> array['security_invoker=true']),
  3, 'all three views are security_invoker');

-- Every SECURITY DEFINER function pins its search_path (prevents search-path hijacking).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
  0, 'every SECURITY DEFINER function sets search_path to empty');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
  0, 'no function in public leaves search_path unset');

-- Account and enrolment functions are SECURITY DEFINER (they must write what clients cannot).
select is(
  (select array_agg(proname::text order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  array['activate_enrollment', 'archive_enrollment', 'assert_enrollment_has_group', 'change_enrollment_attempt',
        'check_enrollment_has_group_on_enrollment', 'check_enrollment_has_group_on_group_delete', 'create_enrollment',
        'delete_my_account', 'get_my_quota', 'handle_new_user', 'quota_consume', 'quota_release', 'quota_take', 'set_enrollment_groups'],
  'the SECURITY DEFINER set is exactly the intended fourteen functions (the three deferred-check functions must work at commit time)');

select * from finish();
rollback;
