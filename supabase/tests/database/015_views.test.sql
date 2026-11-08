-- M3: derived data is computed, not stored, and the views behave correctly and respect the caller's RLS.
begin;
select tests.build_personal_fixture();
select plan(29);

create temp table k on commit drop as select
  tests.claims('11111111-1111-4111-8111-111111111111') as ca, tests.claims('22222222-2222-4222-8222-222222222222') as cb,
  'aaaaaaaa-0000-4000-8000-0000000000e1'::uuid as ea, 'aaaaaaaa-0000-4000-8000-0000000000e2'::uuid as ea2, 'bbbbbbbb-0000-4000-8000-0000000000e1'::uuid as eb,
  (select id from public.chapters where stable_key = 'fake-ch-1') as ch1,
  (select id from public.chapters where stable_key = 'fake-ch-2') as ch2,
  (select id from public.chapters where stable_key = 'fake-ch-3') as ch3,
  (select id from public.chapters where stable_key = 'fake-ch-4') as ch4;

-- chapter_stats: hours, questions and last-studied are DERIVED from the records ---------------------------------------------
select is((select actual_minutes from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch1 from k)), 80, 'chapter 1: 50 + 30 minutes');
select is((select actual_minutes from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch2 from k)), 25, 'chapter 2: 25 minutes');
select is((select questions from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch1 from k)), 30, 'chapter 1: 20 + 10 questions');
select is((select correct from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch1 from k)), 20, 'chapter 1: 15 + 5 correct');
select is((select last_studied::text from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch1 from k)), '2090-01-12', 'last studied is the latest of study time and practice (practice on the 12th)');
select is((select last_studied::text from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch2 from k)), '2090-01-10', 'a chapter with only study time uses that date');
select is((select count(*)::int from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch3 from k)), 0, 'an untouched chapter has no row (the app treats it as zero)');
select is((select count(*)::int from public.chapter_stats where enrollment_id = (select ea2 from k)), 1, 'the archived enrolment keeps its own separate stats');
select is((select actual_minutes from public.chapter_stats where enrollment_id = (select ea2 from k)), 40, 'and they are not mixed into the active one');

-- practice-only and study-only chapters both appear (full join, no row multiplication) -------------------------------------
insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
  values ('fake-prac-only', '11111111-1111-4111-8111-111111111111', (select ea from k), (select csv1 from (select id as csv1 from public.course_syllabus_versions where stable_key = 'fake-csv-1') c), (select ch3 from k), '2090-02-02', 8, 6);
select is((select actual_minutes from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch3 from k)), 0, 'a practice-only chapter shows 0 study minutes');
select is((select questions from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch3 from k)), 8, 'and its questions');
select is((select actual_minutes from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch1 from k)), 80, 'adding practice to other chapters does not multiply study minutes');

-- daily_study_minutes and consistency with chapter_stats --------------------------------------------------------------------------
select is((select minutes from public.daily_study_minutes where enrollment_id = (select ea from k) and local_date = '2090-01-10'), 75, 'day total: 50 + 25');
select is((select minutes from public.daily_study_minutes where enrollment_id = (select ea from k) and local_date = '2090-01-11'), 30, 'next day: 30');
select is(
  (select sum(minutes)::int from public.daily_study_minutes where enrollment_id = (select ea from k)),
  (select sum(actual_minutes)::int from public.chapter_stats where enrollment_id = (select ea from k)),
  'daily totals and per-chapter totals always agree (one stored source)');
delete from public.study_sessions where client_id = 'fake-focus-a1' and user_id = '11111111-1111-4111-8111-111111111111';
select is((select actual_minutes from public.chapter_stats where enrollment_id = (select ea from k) and chapter_id = (select ch1 from k)), 30, 'removing a record updates the stats immediately (nothing is cached)');
select is((select minutes from public.daily_study_minutes where enrollment_id = (select ea from k) and local_date = '2090-01-10'), 25, 'and the daily total');

-- As the signed-in user -----------------------------------------------------------------------------------------------------------
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.chapter_stats'), '4', 'A sees 4 chapter-stats rows: chapters 1, 2 and 3 of the active enrolment plus one of the archived enrolment');
select is(tests.value_as('authenticated', (select ca from k), format('select count(*) from public.chapter_stats where enrollment_id = %L', (select ea2 from k))), '1', 'the archived enrolment''s row is A''s own');
select is(tests.value_as('authenticated', (select cb from k), 'select sum(actual_minutes) from public.chapter_stats'), '80', 'B sees only B''s own totals (60 + 20)');
select is(tests.value_as('authenticated', (select cb from k), 'select count(*) from public.daily_study_minutes'), '2', 'and only B''s own days');

-- enrollment_options: only verified, enabled, complete combinations -----------------------------------------------------------
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.enrollment_options'), '2', 'two options: csv 1 with attempt A and with attempt B');
select is(tests.value_as('authenticated', (select ca from k), $$select count(*) from public.enrollment_options where course_name = 'FAKE Course A' and syllabus_name = 'FAKE Syllabus 1'$$), '2', 'both belong to the one verified course and syllabus');
select is(tests.value_as('authenticated', (select ca from k), $$select jsonb_array_length(groups) from public.enrollment_options limit 1$$), '2', 'each option lists the syllabus''s two published groups');
select is(tests.value_as('authenticated', (select ca from k), $$select (groups -> 0 ->> 'name') from public.enrollment_options limit 1$$), 'FAKE Group 1', 'groups come in official order');
select is(tests.value_as('authenticated', (select ca from k), $$select count(*) from public.enrollment_options where exam_start_date is not null$$), '0', 'no exam date is shown unless one was verified');
update public.course_attempt_availability set status = 'disabled' where exam_attempt_id = (select id from public.exam_attempts where stable_key = 'fake-attempt-b');
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.enrollment_options'), '1', 'a disabled attempt disappears from the options');
update public.courses set status = 'retired' where stable_key = 'fake-course-a';
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.enrollment_options'), '0', 'and nothing is offered once the course is no longer ready');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.enrollment_options'), 'ERR:42501', 'anon cannot see the options');

select * from finish();
rollback;
