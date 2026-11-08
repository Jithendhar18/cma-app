-- M3 (U5): broad absolute date bounds, 2000-01-01 to 2100-12-31, on every personal date column. Wide enough that no
-- historical import and no far-ahead planning is rejected; narrow enough to stop junk such as year 0001 or 9999.
begin;
select tests.build_personal_fixture();
select plan(74);

create temp table k on commit drop as select
  '11111111-1111-4111-8111-111111111111'::uuid as ua, 'aaaaaaaa-0000-4000-8000-0000000000e1'::uuid as ea,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.chapters where stable_key = 'fake-ch-3') as ch3,
  (select id from public.subjects where stable_key = 'fake-subject-1') as subj1;

-- Each template takes one date. Inserts use fresh client ids; revisions and enrolments are updates of fixture rows.
create temp table cases on commit drop as select * from (values
  ('student_enrollments.exam_date_override',  'student_enrollments_exam_date_override_bounds',  $$update public.student_enrollments set exam_date_override = %L where id = 'aaaaaaaa-0000-4000-8000-0000000000e1'$$),
  ('student_enrollments.final_revision_date', 'student_enrollments_final_revision_date_bounds', $$update public.student_enrollments set exam_date_override = null, final_revision_date = %L where id = 'aaaaaaaa-0000-4000-8000-0000000000e1'$$),
  ('chapter_progress.completed_on',           'chapter_progress_completed_on_bounds',           $$update public.chapter_progress set completed_on = %L where user_id = '11111111-1111-4111-8111-111111111111' and status = 'learning'$$),
  ('planner_sessions.planned_date',           'planner_sessions_planned_date_bounds',           $$update public.planner_sessions set planned_date = %L where client_id = 'fake-s-a1'$$),
  ('study_sessions.local_date',               'study_sessions_local_date_bounds',               $$update public.study_sessions set local_date = %L where client_id = 'fake-focus-a1' and user_id = '11111111-1111-4111-8111-111111111111'$$),
  ('revisions.due_date',                      'revisions_due_date_bounds',                      $$update public.revisions set due_date = %L where client_id = 'fake-rev-a2'$$),
  ('revisions.completed_on',                  'revisions_completed_on_bounds',                  $$update public.revisions set completed_on = %L where client_id = 'fake-rev-a2'$$),
  ('revisions.cancelled_on',                  'revisions_cancelled_on_bounds',                  $$update public.revisions set cancelled_on = %L where client_id = 'fake-rev-b1'$$),
  ('practice_records.local_date',             'practice_records_local_date_bounds',             $$update public.practice_records set local_date = %L where client_id = 'fake-prac-a1'$$),
  ('mock_tests.taken_on',                     'mock_tests_taken_on_bounds',                     $$update public.mock_tests set taken_on = %L where client_id = 'fake-mock-a1'$$)
) as v(label, constraint_name, template);

-- rejected: just outside the window on each side, and absurd values
select throws_like(format(c.template, d.value), '%violates check constraint "' || c.constraint_name || '"%', c.label || ' rejects ' || d.value)
  from cases c cross join (values ('1999-12-31'), ('2101-01-01'), ('0001-01-01'), ('9999-12-31')) as d(value);

-- accepted: both edges, an old historical date and a far-future plan
select lives_ok(format(c.template, d.value), c.label || ' accepts ' || d.value)
  from cases c cross join (values ('2000-01-01'), ('2100-12-31'), ('2015-06-15')) as d(value);

-- the bounds are not so tight that normal planning breaks
select lives_ok(format(cases.template, '2030-03-03'), cases.label || ' accepts a date a few years ahead') from cases where label = 'planner_sessions.planned_date';

-- NULL stays valid for the optional columns
select lives_ok($$update public.student_enrollments set exam_date_override = null, final_revision_date = null where id = 'aaaaaaaa-0000-4000-8000-0000000000e1'$$, 'optional dates can be null');

-- inserts are bounded too, not only updates
select throws_like(format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-date-1', %L, %L, %L, %L, '1999-01-01', 10, 'pomodoro')$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch3 from k)),
  '%study_sessions_local_date_bounds%', 'an insert with an out-of-range date is refused');

-- the bounds are named and visible
select is((select count(*)::int from pg_constraint where conname like '%\_bounds' and connamespace = 'public'::regnamespace and contype = 'c'), 10, 'ten named date-bound constraints exist');

select * from finish();
rollback;
