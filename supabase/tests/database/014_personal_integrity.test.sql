-- M3: idempotency, value rules, revision invariants and immutability for personal records.
begin;
select tests.build_personal_fixture();
select plan(50);

create temp table k on commit drop as select
  '11111111-1111-4111-8111-111111111111'::uuid as ua, '22222222-2222-4222-8222-222222222222'::uuid as ub,
  tests.claims('11111111-1111-4111-8111-111111111111') as ca,
  'aaaaaaaa-0000-4000-8000-0000000000e1'::uuid as ea, 'bbbbbbbb-0000-4000-8000-0000000000e1'::uuid as eb,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.chapters where stable_key = 'fake-ch-1') as ch1,
  (select id from public.chapters where stable_key = 'fake-ch-2') as ch2,
  (select id from public.chapters where stable_key = 'fake-ch-3') as ch3,
  (select id from public.subjects where stable_key = 'fake-subject-1') as subj1;

-- Duplicate prevention: the client id is the idempotency key ------------------------------------------------------------
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-focus-a1', %L, %L, %L, %L, '2090-01-10', 50, 'pomodoro')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  '23505', null, 'a focus record with an existing client id is refused');
select lives_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-focus-a1', %L, %L, %L, %L, '2090-01-10', 50, 'pomodoro') on conflict (user_id, client_id) do nothing$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  'retrying the same write with ON CONFLICT DO NOTHING is accepted (idempotent)');
select is((select count(*)::int from public.study_sessions where client_id = 'fake-focus-a1'), 1, 'and still exactly one row exists');
select is((select minutes::int from public.study_sessions where client_id = 'fake-focus-a1'), 50, 'the original row was not rewritten');
insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-focus-a1', (select ub from k), (select eb from k), (select csv1 from k), (select ch1 from k), '2090-01-10', 5, 'pomodoro');
select is((select count(*)::int from public.study_sessions where client_id = 'fake-focus-a1'), 2, 'the same client id is allowed for a different user (ids are scoped per user)');
select throws_ok(format($q$insert into public.planner_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes)
  values ('fake-s-a1', %L, %L, %L, %L, '2090-02-01', '10:00', 30)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23505', null, 'duplicate planned-session client id refused');
select throws_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
  values ('fake-rev-a1', %L, %L, %L, %L, 3, '2090-02-01')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch2 from k)), '23505', null, 'duplicate revision client id refused');
select throws_ok(format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
  values ('fake-prac-a1', %L, %L, %L, %L, '2090-02-01', 5, 5)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23505', null, 'duplicate practice client id refused');
select throws_ok(format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
  values ('fake-mock-a1', %L, %L, %L, %L, '2090-02-01', 'x', 1, 2)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select subj1 from k)), '23505', null, 'duplicate mock client id refused');
select throws_ok(format($q$insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id) values (%L, %L, %L, %L)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  '23505', null, 'a chapter has one progress row per enrolment');
select throws_ok(format($q$insert into public.local_import_runs (user_id, enrollment_id, source_sha256) values (%L, %L, repeat('a', 64))$q$, (select ua from k), (select ea from k)),
  '23505', null, 'the same backup file cannot be imported twice');
select throws_ok(format($q$insert into public.local_import_runs (user_id, enrollment_id, source_sha256) values (%L, %L, 'not-a-hash')$q$, (select ua from k), (select ea from k)),
  '23514', null, 'an import hash must be a sha-256 digest');

-- Value rules ------------------------------------------------------------------------------------------------------------
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode) values ('fake-v1', %L, %L, %L, %L, '2090-02-01', 0, 'pomodoro')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'focus minutes cannot be 0');
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode) values ('fake-v2', %L, %L, %L, %L, '2090-02-01', 1441, 'pomodoro')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'focus minutes cannot exceed a day');
select throws_ok(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode) values ('fake-v3', %L, %L, %L, %L, '2090-02-01', 10, 'timer')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'focus mode must be a known value');
select throws_ok(format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct) values ('fake-v4', %L, %L, %L, %L, '2090-02-01', 5, 6)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'correct answers cannot exceed questions attempted');
select throws_ok(format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct) values ('fake-v5', %L, %L, %L, %L, '2090-02-01', 0, 0)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'a practice record needs at least one question');
select throws_ok(format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct) values ('fake-v6', %L, %L, %L, %L, '2090-02-01', 5, -1)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'correct answers cannot be negative');
select throws_ok(format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score) values ('fake-v7', %L, %L, %L, %L, '2090-02-01', 'x', 101, 100)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select subj1 from k)), '23514', null, 'a mock score cannot exceed its maximum');
select throws_ok(format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score) values ('fake-v8', %L, %L, %L, %L, '2090-02-01', 'x', 0, 0)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select subj1 from k)), '23514', null, 'a mock maximum must be positive');
select throws_ok(format($q$insert into public.planner_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes) values ('fake-v9', %L, %L, %L, %L, '2090-02-01', '10:00', 4)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, 'a planned session needs at least 5 minutes');
select throws_ok(format($q$insert into public.planner_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, planned_date, start_time, duration_minutes, status) values ('fake-v10', %L, %L, %L, %L, '2090-02-01', '10:00', 30, 'missed')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)), '23514', null, '"missed" is derived, so it cannot be stored');
select throws_ok(format($q$update public.chapter_progress set confidence = 6 where user_id = %L$q$, (select ua from k)), '23514', null, 'confidence is 1 to 5 (upper bound)');
select throws_ok(format($q$update public.chapter_progress set confidence = 0 where user_id = %L$q$, (select ua from k)), '23514', null, 'confidence is 1 to 5 (lower bound)');
select throws_ok(format($q$update public.chapter_progress set status = 'done' where user_id = %L$q$, (select ua from k)), '23514', null, 'chapter status must be a known value');
select throws_ok(format($q$update public.chapter_progress set notes = repeat('x', 5001) where user_id = %L$q$, (select ua from k)), '23514', null, 'notes are capped at 5000 characters');

-- Revision invariants -------------------------------------------------------------------------------------------------------
select throws_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date, completed_on, cancelled_on)
  values ('fake-r1', %L, %L, %L, %L, 3, '2090-02-01', '2090-02-01', '2090-02-01')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch2 from k)),
  '23514', null, 'a revision cannot be both completed and cancelled');
select throws_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
  values ('fake-r2', %L, %L, %L, %L, 3, '2090-02-01')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  '23505', null, 'a chapter cannot have two pending revisions (A already has revision 2 pending on chapter 1)');
select throws_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date, completed_on)
  values ('fake-r3', %L, %L, %L, %L, 1, '2090-02-01', '2090-02-01')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  '23505', null, 'a revision number cannot be live twice for a chapter');
select throws_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
  values ('fake-r4', %L, %L, %L, %L, 5, '2090-02-01')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch2 from k)),
  '23514', null, 'revision numbers are 1 to 4');
select lives_ok(format($q$update public.revisions set cancelled_on = '2090-01-18' where user_id = %L and revision_number = 2$q$, (select ua from k)), 'a pending revision can be cancelled');
select lives_ok(format($q$insert into public.revisions (client_id, user_id, enrollment_id, csv_id, chapter_id, revision_number, due_date)
  values ('fake-r5', %L, %L, %L, %L, 2, '2090-02-20')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k)),
  'once cancelled, the same number can be scheduled again (history is kept)');
select is((select count(*)::int from public.revisions where user_id = (select ua from k) and chapter_id = (select ch1 from k) and revision_number = 2), 2, 'both the cancelled and the live revision 2 exist');
select is(tests.dml_as('authenticated', (select ca from k), $$delete from public.revisions$$), '42501', 'revision history cannot be deleted by a client');

-- Immutable columns -----------------------------------------------------------------------------------------------------------
select throws_ok(format($q$update public.study_sessions set client_id = 'changed' where client_id = 'fake-focus-a2' and user_id = %L$q$, (select ua from k)), '23514', null, 'client_id cannot change (it is the idempotency key)');
select throws_ok(format($q$update public.study_sessions set chapter_id = %L where client_id = 'fake-focus-a2' and user_id = %L$q$, (select ch1 from k), (select ua from k)), '23514', null, 'a focus record cannot be moved to another chapter');
select throws_ok(format($q$update public.study_sessions set enrollment_id = %L where client_id = 'fake-focus-a2' and user_id = %L$q$, (select eb from k), (select ua from k)), '23514', null, 'a focus record cannot be moved to another enrolment');
select throws_ok(format($q$update public.planner_sessions set user_id = %L where client_id = 'fake-s-a1'$q$, (select ub from k)), '23514', null, 'a planned session cannot change owner');
select throws_ok(format($q$update public.revisions set chapter_id = %L where client_id = 'fake-rev-a2'$q$, (select ch2 from k)), '23514', null, 'a revision cannot move to another chapter');
select throws_ok(format($q$update public.chapter_progress set chapter_id = %L where user_id = %L and chapter_id = %L$q$, (select ch3 from k), (select ua from k), (select ch1 from k)), '23514', null, 'progress cannot move to another chapter');
select throws_ok(format($q$update public.student_enrollments set csv_id = gen_random_uuid() where id = %L$q$, (select ea from k)), '23514', null, 'an enrolment''s syllabus never changes');
select throws_ok(format($q$update public.mock_tests set subject_id = (select id from public.subjects where stable_key = 'fake-subject-2') where user_id = %L$q$, (select ua from k)), '23514', null, 'a mock test cannot move to another paper');
select lives_ok(format($q$update public.study_sessions set notes = 'FAKE edited' where client_id = 'fake-focus-a2' and user_id = %L$q$, (select ua from k)), 'mutable fields still update');

-- Lifecycle: planned session removed, curriculum referenced ------------------------------------------------------------------
delete from public.planner_sessions where client_id = 'fake-s-a1';
select is((select count(*)::int from public.study_sessions where client_id = 'fake-focus-a1' and user_id = (select ua from k)), 1, 'deleting a planned session keeps the logged time ...');
select is((select planner_session_id from public.study_sessions where client_id = 'fake-focus-a1' and user_id = (select ua from k)), null, '... and detaches it');
select is((select minutes::int from public.study_sessions where client_id = 'fake-focus-a1' and user_id = (select ua from k)), 50, 'with its minutes unchanged');

insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
  select (select csv1 from k), (select subj1 from k), 'fake-draft-ref', 'FAKE draft chapter', 90;
insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id)
  select (select ua from k), (select ea from k), (select csv1 from k), id from public.chapters where stable_key = 'fake-draft-ref';
select throws_ok($$delete from public.chapters where stable_key = 'fake-draft-ref'$$, '23503', null, 'curriculum a student has progress on cannot be deleted (RESTRICT), even a draft');
update public.chapters set status = 'retired' where stable_key = 'fake-ch-3';
select is((select count(*)::int from public.chapters where stable_key = 'fake-ch-3'), 1, 'retiring curriculum keeps the chapter row, so student references keep resolving');

-- Day-boundary accounting: the stored local_date is authoritative and is never re-derived ----------------------------------
insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode, started_at) values
  ('fake-mid-1', (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k), '2090-03-01', 20, 'pomodoro', '2090-03-01 18:20:00+00'),
  ('fake-mid-2', (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k), '2090-03-02', 30, 'pomodoro', '2090-03-01 18:40:00+00');
select is((select local_date::text from public.study_sessions where client_id = 'fake-mid-2' and user_id = (select ua from k)), '2090-03-02', 'a block that crossed local midnight keeps the date the device assigned, whatever the UTC instant');
select is((select sum(minutes)::int from public.study_sessions where client_id like 'fake-mid-%' and user_id = (select ua from k)), 50, 'and the split total (20 + 30) is unchanged');

select * from finish();
rollback;
