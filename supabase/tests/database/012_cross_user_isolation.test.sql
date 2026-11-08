-- M3: strict cross-user isolation, tested at BOTH layers.
--   Layer 1, row level security: user A cannot see, change or delete user B's rows.
--   Layer 2, composite foreign keys: a row cannot reference another user's enrolment or another syllabus's
--            chapter, EVEN WITH RLS BYPASSED (these checks run as the owner role, which ignores RLS).
begin;
select tests.build_personal_fixture();
select plan(123);

create temp table k on commit drop as select
  '11111111-1111-4111-8111-111111111111'::uuid as ua,
  '22222222-2222-4222-8222-222222222222'::uuid as ub,
  tests.claims('11111111-1111-4111-8111-111111111111') as ca,
  tests.claims('22222222-2222-4222-8222-222222222222') as cb,
  'aaaaaaaa-0000-4000-8000-0000000000e1'::uuid as ea,
  'aaaaaaaa-0000-4000-8000-0000000000e2'::uuid as ea2,
  'bbbbbbbb-0000-4000-8000-0000000000e1'::uuid as eb,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-2') as csv2,
  (select id from public.chapters where stable_key = 'fake-ch-1') as ch1,
  (select id from public.chapters where stable_key = 'fake-ch-x') as ch_x,
  (select id from public.subject_groups where stable_key = 'fake-group-2') as g2,
  (select id from public.subjects where stable_key = 'fake-subject-x') as subj_x,
  (select id from public.exam_attempts where stable_key = 'fake-attempt-a') as att_a,
  (select id from public.subject_groups where stable_key = 'fake-group-1') as g1;

-- ==================================================== LAYER 1: row level security
-- A sees only their own rows in every table that has an owner column -------------------------------------------
select is(tests.value_as('authenticated', (select ca from k), format('select count(*) from public.%I where user_id <> %L', t, (select ua from k))), '0',
          t || ': A sees none of B''s rows')
  from unnest(array['user_settings', 'student_enrollments', 'enrollment_groups', 'chapter_progress', 'planner_sessions',
                    'study_sessions', 'revisions', 'practice_records', 'mock_tests', 'local_import_runs']) as t;
select is(tests.value_as('authenticated', (select ca from k), format('select count(*) from public.%I where user_id = %L', t, (select ua from k))), n::text,
          t || ': A sees all of A''s own rows (so the zero above is isolation, not an empty table)')
  from (values ('student_enrollments', 2), ('enrollment_groups', 3), ('chapter_progress', 2), ('planner_sessions', 3),
               ('study_sessions', 4), ('revisions', 2), ('practice_records', 2), ('mock_tests', 1), ('local_import_runs', 1)) as v(t, n);
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.profiles'), '1', 'profiles: A sees only A');
select is(tests.value_as('authenticated', (select cb from k), 'select count(*) from public.study_sessions'), '2', 'and symmetrically, B sees only B''s two focus records');
select is(tests.value_as('authenticated', (select cb from k), $$select count(*) from public.chapter_progress where notes like '%FAKE A%'$$), '0', 'B cannot read A''s private notes');
select is(tests.value_as('authenticated', (select ca from k), $$select count(*) from public.chapter_progress where notes like '%FAKE B%'$$), '0', 'A cannot read B''s private notes');

-- A cannot write rows owned by B ------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-evil-1', %L, %L, %L, %L, '2090-02-01', 10, 'pomodoro')$q$, (select ub from k), (select eb from k), (select csv1 from k), (select ch1 from k))), '42501',
  'A cannot insert a focus record owned by B');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id)
  values (%L, %L, %L, %L)$q$, (select ub from k), (select eb from k), (select csv1 from k), (select ch1 from k))), '42501', 'A cannot create progress for B');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.planner_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes)
  values ('fake-evil-2', %L, %L, %L, %L, '2090-02-01', '10:00', 30)$q$, (select ub from k), (select eb from k), (select csv1 from k), (select ch1 from k))), '42501', 'A cannot plan a session for B');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
  values ('fake-evil-3', %L, %L, %L, %L, 3, '2090-02-01')$q$, (select ub from k), (select eb from k), (select csv1 from k), (select ch1 from k))), '42501', 'A cannot schedule a revision for B');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
  values ('fake-evil-4', %L, %L, %L, %L, '2090-02-01', 5, 5)$q$, (select ub from k), (select eb from k), (select csv1 from k), (select ch1 from k))), '42501', 'A cannot log practice for B');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
  values ('fake-evil-5', %L, %L, %L, (select id from public.subjects where stable_key = 'fake-subject-1'), '2090-02-01', 'x', 1, 2)$q$, (select ub from k), (select eb from k), (select csv1 from k))), '42501', 'A cannot add a mock test for B');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.local_import_runs (user_id, enrollment_id, source_sha256) values (%L, %L, repeat('e', 64))$q$, (select ub from k), (select eb from k))), '42501', 'A cannot log an import for B');

-- A cannot change or delete B's rows (silent no-ops under RLS, verified by checking B's data) --------------------------
select is(tests.dml_as('authenticated', (select ca from k), $$update public.chapter_progress set notes = 'HACKED', confidence = 5 where notes like '%FAKE B%'$$), 'OK', 'A''s update aimed at B''s progress is a no-op ...');
select is((select notes from public.chapter_progress where user_id = (select ub from k)), 'FAKE B private notes', '... B''s notes are unchanged');
select is(tests.dml_as('authenticated', (select ca from k), format($q$delete from public.study_sessions where user_id = %L$q$, (select ub from k))), 'OK', 'A''s delete aimed at B''s focus records is a no-op ...');
select is((select count(*)::int from public.study_sessions where user_id = (select ub from k)), 2, '... B still has both');
select is(tests.dml_as('authenticated', (select ca from k), format($q$delete from public.planner_sessions where user_id = %L$q$, (select ub from k))), 'OK', 'A cannot delete B''s planned sessions ...');
select is((select count(*)::int from public.planner_sessions where user_id = (select ub from k)), 1, '... B''s plan is intact');
select is(tests.dml_as('authenticated', (select ca from k), format($q$update public.student_enrollments set exam_date_override = '2090-06-01' where id = %L$q$, (select eb from k))), 'OK', 'A cannot change B''s exam date ...');
select is((select exam_date_override from public.student_enrollments where id = (select eb from k)), null, '... it is still unset');
select is(tests.dml_as('authenticated', (select ca from k), format($q$update public.user_settings set theme = 'light' where user_id = %L$q$, (select ub from k))), 'OK', 'A cannot change B''s settings ...');
select is((select theme from public.user_settings where user_id = (select ub from k)), 'dark', '... B''s theme is unchanged');
select is(tests.dml_as('authenticated', (select ca from k), format($q$update public.revisions set completed_on = '2090-02-02' where user_id = %L$q$, (select ub from k))), 'OK', 'A cannot complete B''s revisions ...');
select is((select count(*)::int from public.revisions where user_id = (select ub from k) and completed_on is not null), 0, '... none of B''s revisions is completed');

select is(tests.dml_as('authenticated', (select ca from k), format('update public.local_import_runs set counts = %L::jsonb where user_id = %L', '{}', (select ub from k))), '42501', 'the import log is append-only: updates are refused outright');

-- Moving a row between users is impossible ----------------------------------------------------------------------------
select ok(tests.dml_as('authenticated', (select ca from k), format($q$update public.study_sessions set user_id = %L where user_id = %L$q$, (select ub from k), (select ua from k))) in ('23514', '42501'),
  'A cannot hand their own focus record to B (user_id is immutable)');
select ok(tests.dml_as('authenticated', (select ca from k), format($q$update public.chapter_progress set enrollment_id = %L where user_id = %L$q$, (select eb from k), (select ua from k))) in ('23514', '42501', '23503'),
  'A cannot re-attach their progress to B''s enrolment');
select is((select count(*)::int from public.study_sessions where user_id = (select ua from k)), 4, 'A still owns all four of their focus records');

-- anon sees nothing at all ------------------------------------------------------------------------------------------
select is(tests.value_as('anon', '{"role":"anon"}', format('select count(*) from public.%I', t)), 'ERR:42501', 'anon cannot read ' || t)
  from unnest(array['profiles', 'user_settings', 'student_enrollments', 'enrollment_groups', 'chapter_progress', 'planner_sessions',
                    'study_sessions', 'revisions', 'practice_records', 'mock_tests', 'local_import_runs',
                    'chapter_stats', 'daily_study_minutes', 'enrollment_options']) as t;

-- Views show only the caller's data ---------------------------------------------------------------------------------------
select is(tests.value_as('authenticated', (select ca from k), format('select count(*) from public.chapter_stats where enrollment_id = %L', (select eb from k))), '0', 'chapter_stats hides B''s enrolment from A');
select is(tests.value_as('authenticated', (select ca from k), format('select count(*) from public.daily_study_minutes where enrollment_id = %L', (select eb from k))), '0', 'daily_study_minutes hides B''s enrolment from A');
select is(tests.value_as('authenticated', (select ca from k), format('select sum(actual_minutes) from public.chapter_stats where enrollment_id = %L', (select ea from k))), '105', 'A''s own chapter_stats totals are visible (50+25+30)');

-- A forged admin claim gains nothing ----------------------------------------------------------------------------------------
select is(tests.value_as('authenticated',
  json_build_object('role', 'authenticated', 'sub', (select ua from k), 'user_metadata', json_build_object('role', 'admin', 'is_admin', true), 'app_metadata', json_build_object())::text,
  format('select count(*) from public.study_sessions where user_id = %L', (select ub from k))), '0', 'forged admin metadata does not reveal B''s rows');

-- ==================================================== LAYER 2: composite foreign keys, RLS bypassed
-- These run as the table owner, which ignores RLS. The database still refuses.
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-fk-1', %L, %L, %L, %L, '2090-02-01', 10, 'pomodoro')$q$, (select ua from k), (select eb from k), (select csv1 from k), (select ch1 from k)),
  '23503', null, 'owner role: a focus record cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id)
  values (%L, %L, %L, (select id from public.chapters where stable_key = 'fake-ch-3'))$q$, (select ua from k), (select eb from k), (select csv1 from k)),
  '23503', null, 'owner role: progress cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.planner_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes)
  values ('fake-fk-2', %L, %L, %L, %L, '2090-02-01', '10:00', 30)$q$, (select ua from k), (select eb from k), (select csv1 from k), (select ch1 from k)),
  '23503', null, 'owner role: a planned session cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
  values ('fake-fk-3', %L, %L, %L, %L, 3, '2090-02-01')$q$, (select ua from k), (select eb from k), (select csv1 from k), (select ch1 from k)),
  '23503', null, 'owner role: a revision cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
  values ('fake-fk-4', %L, %L, %L, %L, '2090-02-01', 5, 5)$q$, (select ua from k), (select eb from k), (select csv1 from k), (select ch1 from k)),
  '23503', null, 'owner role: practice cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
  values ('fake-fk-5', %L, %L, %L, (select id from public.subjects where stable_key = 'fake-subject-1'), '2090-02-01', 'x', 1, 2)$q$, (select ua from k), (select eb from k), (select csv1 from k)),
  '23503', null, 'owner role: a mock test cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.local_import_runs (user_id, enrollment_id, source_sha256) values (%L, %L, repeat('d', 64))$q$, (select ua from k), (select eb from k)),
  '23503', null, 'owner role: an import log cannot reference another user''s enrolment');
select throws_ok(format($q$insert into public.enrollment_groups (enrollment_id, subject_group_id, user_id, csv_id) values (%L, %L, %L, %L)$q$, (select eb from k), (select g2 from k), (select ua from k), (select csv1 from k)),
  '23503', null, 'owner role: A cannot attach a group to B''s enrolment');

-- the right user but the WRONG SYLLABUS ------------------------------------------------------------------------------------
select throws_ok(format($q$insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id) values (%L, %L, %L, %L)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch_x from k)),
  '23503', null, 'a chapter from another syllabus cannot be tracked under this enrolment');
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-fk-6', %L, %L, %L, %L, '2090-02-01', 10, 'pomodoro')$q$, (select ua from k), (select ea from k), (select csv2 from k), (select ch_x from k)),
  '23503', null, 'claiming the other syllabus does not help: the enrolment''s syllabus is checked too');
select throws_ok(format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
  values ('fake-fk-7', %L, %L, %L, %L, '2090-02-01', 'x', 1, 2)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select subj_x from k)),
  '23503', null, 'a paper from another syllabus cannot be used for a mock test');
select throws_ok(format($q$insert into public.enrollment_groups (enrollment_id, subject_group_id, user_id, csv_id)
  values (%L, (select id from public.subject_groups where stable_key = 'fake-group-x'), %L, %L)$q$, (select ea from k), (select ua from k), (select csv1 from k)),
  '23503', null, 'a group from another syllabus cannot be selected');

-- a focus record can only credit a planned session of the same user AND the same enrolment -------------------------------------
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode, planner_session_id)
  values ('fake-fk-8', %L, %L, %L, %L, '2090-02-01', 10, 'planner', 'bbbbbbbb-0000-4000-8000-0000000000a1')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  '23503', null, 'a focus record cannot credit B''s planned session');
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode, planner_session_id)
  values ('fake-fk-9', %L, %L, %L, %L, '2090-02-01', 10, 'planner', 'aaaaaaaa-0000-4000-8000-0000000000b1')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  '23503', null, 'nor A''s own planned session from a DIFFERENT (archived) enrolment');

-- RPCs act only on the caller's own enrolments ---------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select ca from k), format('select public.change_enrollment_attempt(%L, %L)', (select eb from k), (select att_a from k))), '42501', 'A cannot change B''s attempt');
select is(tests.dml_as('authenticated', (select ca from k), format('select public.set_enrollment_groups(%L, array[%L]::uuid[])', (select eb from k), (select g1 from k))), '42501', 'A cannot change B''s groups');
select is(tests.dml_as('authenticated', (select ca from k), format('select public.archive_enrollment(%L)', (select eb from k))), '42501', 'A cannot archive B''s enrolment');
select is(tests.dml_as('authenticated', (select ca from k), format('select public.activate_enrollment(%L)', (select eb from k))), '42501', 'A cannot activate B''s enrolment');
select is((select status from public.student_enrollments where id = (select eb from k)), 'active', 'B''s enrolment is untouched by all of the above');

-- ====================================================================================================
-- UNCONDITIONAL statements: the form that only the update / delete policy governs.
--
-- When a statement's WHERE clause reads columns, PostgreSQL also applies the (strict) SELECT policy, which
-- hides other users' rows and would MASK a loosened update or delete policy. `delete from t` and
-- `update t set col = constant` read no columns, so only the update/delete policy decides. These tests are
-- destructive to A's own rows, so they run last. Each one checks three things: the statement was accepted,
-- B's data is untouched, and A's own rows WERE affected (so the statement really did something).
-- ====================================================================================================
select is(tests.dml_as('authenticated', (select ca from k), q), 'OK', 'A runs an unconditional update on ' || t)
  from (values
    ('chapter_progress', $$update public.chapter_progress set notes = 'PWNED'$$),
    ('planner_sessions', $$update public.planner_sessions set notes = 'PWNED'$$),
    ('study_sessions',   $$update public.study_sessions set notes = 'PWNED'$$),
    ('practice_records', $$update public.practice_records set correct = 0$$),
    ('mock_tests',       $$update public.mock_tests set name = 'PWNED'$$),
    ('revisions',        $$update public.revisions set priority = 'low'$$),
    ('student_enrollments', $$update public.student_enrollments set exam_date_override = '2090-09-09'$$),
    ('user_settings',    $$update public.user_settings set theme = 'light'$$),
    ('profiles',         $$update public.profiles set display_name = 'PWNED'$$)
  ) as v(t, q);
select is((select notes from public.chapter_progress where user_id = (select ub from k)), 'FAKE B private notes', 'chapter_progress: B''s data unchanged by A''s unconditional update');
select is((select notes from public.planner_sessions where user_id = (select ub from k)), '', 'planner_sessions: B''s data unchanged');
select is((select notes from public.study_sessions where user_id = (select ub from k) and client_id = 'fake-focus-b1'), '', 'study_sessions: B''s data unchanged');
select is((select correct::int from public.practice_records where user_id = (select ub from k)), 9, 'practice_records: B''s data unchanged');
select is((select name from public.mock_tests where user_id = (select ub from k)), 'FAKE B mock', 'mock_tests: B''s data unchanged');
select is((select priority from public.revisions where user_id = (select ub from k)), 'medium', 'revisions: B''s data unchanged');
select is((select exam_date_override from public.student_enrollments where id = (select eb from k)), null, 'student_enrollments: B''s exam date unchanged');
select is((select theme from public.user_settings where user_id = (select ub from k)), 'dark', 'user_settings: B''s theme unchanged');
select is((select display_name from public.profiles where id = (select ub from k)), 'FAKE User B', 'profiles: B''s name unchanged');
select is((select count(*)::int from public.chapter_progress where user_id = (select ua from k) and notes = 'PWNED'), 2, 'chapter_progress: the statement did change A''s own rows');
select is((select count(*)::int from public.planner_sessions where user_id = (select ua from k) and notes = 'PWNED'), 3, 'planner_sessions: A''s own rows changed');
select is((select count(*)::int from public.study_sessions where user_id = (select ua from k) and notes = 'PWNED'), 4, 'study_sessions: A''s own rows changed');
select is((select count(*)::int from public.practice_records where user_id = (select ua from k) and correct = 0), 2, 'practice_records: A''s own rows changed');
select is((select count(*)::int from public.mock_tests where user_id = (select ua from k) and name = 'PWNED'), 1, 'mock_tests: A''s own rows changed');
select is((select count(*)::int from public.revisions where user_id = (select ua from k) and priority = 'low'), 2, 'revisions: A''s own rows changed');
select is((select count(*)::int from public.student_enrollments where user_id = (select ua from k) and exam_date_override = '2090-09-09'), 2, 'student_enrollments: A''s own enrolments changed');
select is((select theme from public.user_settings where user_id = (select ua from k)), 'light', 'user_settings: A''s own settings changed');
select is((select display_name from public.profiles where id = (select ua from k)), 'PWNED', 'profiles: A''s own profile changed');

select is(tests.dml_as('authenticated', (select ca from k), q), 'OK', 'A runs an unconditional delete on ' || t)
  from (values
    ('chapter_progress', 'delete from public.chapter_progress'),
    ('planner_sessions', 'delete from public.planner_sessions'),
    ('study_sessions',   'delete from public.study_sessions'),
    ('practice_records', 'delete from public.practice_records'),
    ('mock_tests',       'delete from public.mock_tests')
  ) as v(t, q);
select is(tests.dml_as('authenticated', (select ca from k), 'delete from public.revisions'), '42501', 'revisions: an unconditional delete is refused outright (no grant)');
select is((select count(*)::int from public.chapter_progress where user_id = (select ub from k)), 1, 'chapter_progress: B''s row survived A''s unconditional delete');
select is((select count(*)::int from public.planner_sessions where user_id = (select ub from k)), 1, 'planner_sessions: B''s row survived');
select is((select count(*)::int from public.study_sessions where user_id = (select ub from k)), 2, 'study_sessions: B''s rows survived');
select is((select count(*)::int from public.practice_records where user_id = (select ub from k)), 1, 'practice_records: B''s row survived');
select is((select count(*)::int from public.mock_tests where user_id = (select ub from k)), 1, 'mock_tests: B''s row survived');
select is((select count(*)::int from public.revisions where user_id = (select ub from k)), 1, 'revisions: B''s row survived');
select is(
  (select count(*)::int from (
     select user_id from public.chapter_progress union all select user_id from public.planner_sessions
     union all select user_id from public.study_sessions union all select user_id from public.practice_records
     union all select user_id from public.mock_tests) x where x.user_id = (select ua from k)),
  0, 'the deletes did remove A''s own rows (so the survival of B''s rows is isolation, not a no-op)');

select * from finish();
rollback;
