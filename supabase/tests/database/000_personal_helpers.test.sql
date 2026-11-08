-- Test helpers for personal-data tests. Like 000_helpers, these exist ONLY in the local/CI test database.
--
--   tests.claims(user)             JWT claims text for a signed-in user, for tests.dml_as / tests.value_as
--   tests.build_personal_fixture() the fake curriculum plus two FAKE users (A and B) with enrolments and records
--
-- Fixed ids make the expectations in the tests readable:
--   user A  11111111-1111-4111-8111-111111111111     user B  22222222-2222-4222-8222-222222222222
--   A's active enrolment  aaaaaaaa-0000-4000-8000-0000000000e1  (attempt A, both groups of csv 1)
--   A's archived one      aaaaaaaa-0000-4000-8000-0000000000e2  (attempt B)
--   B's active enrolment  bbbbbbbb-0000-4000-8000-0000000000e1  (attempt B, group 1 only)

create or replace function tests.claims(p_user uuid)
returns text
language sql
immutable
as $$ select json_build_object('role', 'authenticated', 'sub', p_user)::text $$;

-- JWT claims for a user who authenticated with a PASSWORD p_age_seconds ago (what GoTrue records in `amr`).
create or replace function tests.claims_password_age(p_user uuid, p_age_seconds bigint)
returns text
language sql
stable
as $$
  select json_build_object(
    'role', 'authenticated', 'sub', p_user,
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', floor(extract(epoch from clock_timestamp()))::bigint - p_age_seconds))
  )::text
$$;

-- Runs a statement as an API role and returns 'OK' or 'sqlstate|message|hint', so tests can check the full error.
create or replace function tests.diag_as(p_role text, p_claims text, p_sql text)
returns text
language plpgsql
as $$
declare
  st text; msg text; hnt text;
begin
  perform set_config('request.jwt.claims', p_claims, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  perform set_config('role', 'postgres', true);
  return 'OK';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text, hnt = pg_exception_hint;
  perform set_config('role', 'postgres', true);
  return st || '|' || msg || '|' || coalesce(hnt, '');
end;
$$;

create or replace function tests.build_personal_fixture()
returns void
language plpgsql
as $$
declare
  ua uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  ub uuid := '22222222-2222-4222-8222-222222222222'::uuid;
  ea uuid := 'aaaaaaaa-0000-4000-8000-0000000000e1'::uuid;
  ea2 uuid := 'aaaaaaaa-0000-4000-8000-0000000000e2'::uuid;
  eb uuid := 'bbbbbbbb-0000-4000-8000-0000000000e1'::uuid;
  csv1 uuid; att_a uuid; att_b uuid; g1 uuid; g2 uuid;
  ch1 uuid; ch2 uuid; ch4 uuid; ch5 uuid; subj1 uuid; subj3 uuid;
begin
  perform tests.build_fake_fixture();

  select id into csv1 from public.course_syllabus_versions where stable_key = 'fake-csv-1';
  select id into att_a from public.exam_attempts where stable_key = 'fake-attempt-a';
  select id into att_b from public.exam_attempts where stable_key = 'fake-attempt-b';
  select id into g1 from public.subject_groups where stable_key = 'fake-group-1';
  select id into g2 from public.subject_groups where stable_key = 'fake-group-2';
  select id into ch1 from public.chapters where stable_key = 'fake-ch-1';
  select id into ch2 from public.chapters where stable_key = 'fake-ch-2';
  select id into ch4 from public.chapters where stable_key = 'fake-ch-4';
  select id into ch5 from public.chapters where stable_key = 'fake-ch-5';
  select id into subj1 from public.subjects where stable_key = 'fake-subject-1';
  select id into subj3 from public.subjects where stable_key = 'fake-subject-3';

  -- the trigger on auth.users creates the profile and the settings row
  insert into auth.users (id, email, raw_user_meta_data) values
    (ua, 'a@example.invalid', '{"display_name":"FAKE User A"}'),
    (ub, 'b@example.invalid', '{"display_name":"FAKE User B"}');

  -- A: an archived enrolment (older) and an active one
  insert into public.student_enrollments (id, user_id, csv_id, exam_attempt_id, status, archived_at)
    values (ea2, ua, csv1, att_b, 'archived', now());
  insert into public.enrollment_groups values (ea2, g1, ua, csv1);
  insert into public.student_enrollments (id, user_id, csv_id, exam_attempt_id) values (ea, ua, csv1, att_a);
  insert into public.enrollment_groups values (ea, g1, ua, csv1), (ea, g2, ua, csv1);
  -- B: one active enrolment, group 1 only
  insert into public.student_enrollments (id, user_id, csv_id, exam_attempt_id) values (eb, ub, csv1, att_b);
  insert into public.enrollment_groups values (eb, g1, ub, csv1);

  -- A's data (active enrolment): 4 progress-related rows of each kind are enough to see isolation
  insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id, status, confidence, notes, completed_on)
    values (ua, ea, csv1, ch1, 'completed', 3, 'FAKE A notes', '2090-01-09'), (ua, ea, csv1, ch2, 'learning', 2, '', null);
  insert into public.planner_sessions (id, client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes)
    values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'fake-s-a1', ua, ea, csv1, ch1, '2090-01-10', '18:00', 90),
           ('aaaaaaaa-0000-4000-8000-0000000000a2', 'fake-s-a2', ua, ea, csv1, ch2, '2090-01-11', '19:00', 60);
  insert into public.planner_sessions (id, client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes)
    values ('aaaaaaaa-0000-4000-8000-0000000000b1', 'fake-s-a-old', ua, ea2, csv1, ch1, '2089-12-01', '10:00', 30);
  insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode, planner_session_id) values
    ('fake-focus-a1', ua, ea, csv1, ch1, '2090-01-10', 50, 'pomodoro', 'aaaaaaaa-0000-4000-8000-0000000000a1'),
    ('fake-focus-a2', ua, ea, csv1, ch2, '2090-01-10', 25, 'stopwatch', null),
    ('fake-focus-a3', ua, ea, csv1, ch1, '2090-01-11', 30, 'planner', null);
  insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date, completed_on) values
    ('fake-rev-a1', ua, ea, csv1, ch1, 1, '2090-01-10', '2090-01-10');
  insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date) values
    ('fake-rev-a2', ua, ea, csv1, ch1, 2, '2090-01-17');
  insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct) values
    ('fake-prac-a1', ua, ea, csv1, ch1, '2090-01-10', 20, 15),
    ('fake-prac-a2', ua, ea, csv1, ch1, '2090-01-12', 10, 5);
  insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
    values ('fake-mock-a1', ua, ea, csv1, subj1, '2090-01-12', 'FAKE mock', 60, 100);
  insert into public.local_import_runs (user_id, enrollment_id, source_sha256, counts)
    values (ua, ea, repeat('a', 64), '{"focus":3}'::jsonb);
  -- A's archived enrolment keeps its own history
  insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
    values ('fake-focus-a-old', ua, ea2, csv1, ch1, '2089-12-01', 40, 'pomodoro');

  -- B's data
  insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id, status, confidence, notes)
    values (ub, eb, csv1, ch4, 'practising', 4, 'FAKE B private notes');
  insert into public.planner_sessions (id, client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes)
    values ('bbbbbbbb-0000-4000-8000-0000000000a1', 'fake-s-b1', ub, eb, csv1, ch4, '2090-01-10', '08:00', 45);
  insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode, planner_session_id) values
    ('fake-focus-b1', ub, eb, csv1, ch4, '2090-01-10', 60, 'pomodoro', 'bbbbbbbb-0000-4000-8000-0000000000a1'),
    ('fake-focus-b2', ub, eb, csv1, ch5, '2090-01-11', 20, 'stopwatch', null);
  insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
    values ('fake-rev-b1', ub, eb, csv1, ch4, 1, '2090-01-11');
  insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
    values ('fake-prac-b1', ub, eb, csv1, ch4, '2090-01-10', 12, 9);
  insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
    values ('fake-mock-b1', ub, eb, csv1, subj3, '2090-01-12', 'FAKE B mock', 70, 100);
  insert into public.local_import_runs (user_id, enrollment_id, source_sha256, counts)
    values (ub, eb, repeat('b', 64), '{}'::jsonb);
end;
$$;

select plan(4);
select has_function('tests', 'claims', array['uuid'], 'claims helper installed');
select has_function('tests', 'build_personal_fixture', 'personal fixture builder installed');
select has_function('tests', 'claims_password_age', array['uuid', 'bigint'], 'recent-authentication claims helper installed');
select has_function('tests', 'diag_as', array['text', 'text', 'text'], 'full-diagnostics helper installed');
select * from finish();
