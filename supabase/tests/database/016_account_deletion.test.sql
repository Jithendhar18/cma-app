-- M3: deleting an account removes everything personal, and only that.
begin;
select tests.build_personal_fixture();
select plan(33);

create temp table k on commit drop as select
  '11111111-1111-4111-8111-111111111111'::uuid as ua, '22222222-2222-4222-8222-222222222222'::uuid as ub,
  tests.claims_password_age('11111111-1111-4111-8111-111111111111', 0) as ca, tests.claims_password_age('22222222-2222-4222-8222-222222222222', 0) as cb;

-- a snapshot of everything that must NOT change: B's rows and every shared curriculum row
create temp table before_counts on commit drop as
  select 'profiles' t, count(*) n from public.profiles where id = (select ub from k)
  union all select 'user_settings', count(*) from public.user_settings where user_id = (select ub from k)
  union all select 'student_enrollments', count(*) from public.student_enrollments where user_id = (select ub from k)
  union all select 'enrollment_groups', count(*) from public.enrollment_groups where user_id = (select ub from k)
  union all select 'chapter_progress', count(*) from public.chapter_progress where user_id = (select ub from k)
  union all select 'planner_sessions', count(*) from public.planner_sessions where user_id = (select ub from k)
  union all select 'study_sessions', count(*) from public.study_sessions where user_id = (select ub from k)
  union all select 'revisions', count(*) from public.revisions where user_id = (select ub from k)
  union all select 'practice_records', count(*) from public.practice_records where user_id = (select ub from k)
  union all select 'mock_tests', count(*) from public.mock_tests where user_id = (select ub from k)
  union all select 'local_import_runs', count(*) from public.local_import_runs where user_id = (select ub from k);
create temp table curriculum_before on commit drop as
  select 'courses' t, count(*) n from public.courses
  union all select 'syllabus_versions', count(*) from public.syllabus_versions
  union all select 'course_syllabus_versions', count(*) from public.course_syllabus_versions
  union all select 'exam_attempts', count(*) from public.exam_attempts
  union all select 'course_attempt_availability', count(*) from public.course_attempt_availability
  union all select 'subject_groups', count(*) from public.subject_groups
  union all select 'subjects', count(*) from public.subjects
  union all select 'syllabus_sections', count(*) from public.syllabus_sections
  union all select 'chapters', count(*) from public.chapters
  union all select 'source_references', count(*) from public.source_references;

select cmp_ok((select count(*) from before_counts where n > 0), '=', 11::bigint, 'precondition: B has data in all 11 personal tables');
select cmp_ok((select count(*)::int from public.study_sessions where user_id = (select ua from k)), '>', 0, 'precondition: A has study history');
select cmp_ok((select count(*)::int from public.student_enrollments where user_id = (select ua from k) and status = 'archived'), '=', 1, 'precondition: A also has an archived enrolment');

-- Who may delete -------------------------------------------------------------------------------------------------------------
select is(tests.dml_as('anon', '{"role":"anon"}', 'select public.delete_my_account()'), '42501', 'anon cannot call delete_my_account');
select is(tests.dml_as('authenticated', '{"role":"authenticated"}', 'select public.delete_my_account()'), '28000', 'a call with no user in the token is refused');
select is((select count(*)::int from auth.users where id = (select ua from k)), 1, 'those refusals deleted nothing');
select is(tests.dml_as('authenticated', (select ca from k), format($q$delete from auth.users where id = %L$q$, (select ua from k))), '42501', 'a client cannot delete from auth.users directly');

-- A deletes their account --------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select ca from k), 'select public.delete_my_account()'), 'OK', 'A deletes their own account');

select is((select count(*)::int from auth.users where id = (select ua from k)), 0, 'the auth user is gone');
select is((select count(*)::int from public.profiles where id = (select ua from k)), 0, 'the profile is gone');
select is((select count(*)::int from public.user_settings where user_id = (select ua from k)), 0, 'settings are gone');
select is((select count(*)::int from public.student_enrollments where user_id = (select ua from k)), 0, 'both enrolments (active and archived) are gone');
select is((select count(*)::int from public.enrollment_groups where user_id = (select ua from k)), 0, 'enrolment groups are gone');
select is((select count(*)::int from public.chapter_progress where user_id = (select ua from k)), 0, 'chapter progress is gone');
select is((select count(*)::int from public.planner_sessions where user_id = (select ua from k)), 0, 'planned sessions are gone');
select is((select count(*)::int from public.study_sessions where user_id = (select ua from k)), 0, 'study history is gone');
select is((select count(*)::int from public.revisions where user_id = (select ua from k)), 0, 'revisions are gone (including completed and cancelled history)');
select is((select count(*)::int from public.practice_records where user_id = (select ua from k)), 0, 'practice records are gone');
select is((select count(*)::int from public.mock_tests where user_id = (select ua from k)), 0, 'mock tests are gone');
select is((select count(*)::int from public.local_import_runs where user_id = (select ua from k)), 0, 'import log is gone');
select is(
  (select count(*)::int from (
     select user_id from public.chapter_progress union all select user_id from public.planner_sessions
     union all select user_id from public.study_sessions union all select user_id from public.revisions
     union all select user_id from public.practice_records union all select user_id from public.mock_tests
     union all select user_id from public.student_enrollments union all select user_id from public.enrollment_groups
     union all select user_id from public.local_import_runs union all select user_id from public.user_settings
     union all select id from public.profiles) x where x.user_id = (select ua from k)),
  0, 'not a single row anywhere still carries A''s id');

-- B and the curriculum are untouched ---------------------------------------------------------------------------------------------
select is((select count(*)::int from public.profiles where id = (select ub from k)), 1, 'B''s profile is intact');
select is((select count(*)::int from auth.users where id = (select ub from k)), 1, 'B''s auth user is intact');
select is(
  (select count(*)::int from before_counts b where b.n = case b.t
     when 'profiles' then (select count(*) from public.profiles where id = (select ub from k))
     when 'user_settings' then (select count(*) from public.user_settings where user_id = (select ub from k))
     when 'student_enrollments' then (select count(*) from public.student_enrollments where user_id = (select ub from k))
     when 'enrollment_groups' then (select count(*) from public.enrollment_groups where user_id = (select ub from k))
     when 'chapter_progress' then (select count(*) from public.chapter_progress where user_id = (select ub from k))
     when 'planner_sessions' then (select count(*) from public.planner_sessions where user_id = (select ub from k))
     when 'study_sessions' then (select count(*) from public.study_sessions where user_id = (select ub from k))
     when 'revisions' then (select count(*) from public.revisions where user_id = (select ub from k))
     when 'practice_records' then (select count(*) from public.practice_records where user_id = (select ub from k))
     when 'mock_tests' then (select count(*) from public.mock_tests where user_id = (select ub from k))
     when 'local_import_runs' then (select count(*) from public.local_import_runs where user_id = (select ub from k)) end),
  11, 'all 11 of B''s tables have exactly the rows they had before');
select is((select notes from public.chapter_progress where user_id = (select ub from k)), 'FAKE B private notes', 'B''s data is unchanged, not just present');
select is(
  (select count(*)::int from curriculum_before b where b.n = case b.t
     when 'courses' then (select count(*) from public.courses)
     when 'syllabus_versions' then (select count(*) from public.syllabus_versions)
     when 'course_syllabus_versions' then (select count(*) from public.course_syllabus_versions)
     when 'exam_attempts' then (select count(*) from public.exam_attempts)
     when 'course_attempt_availability' then (select count(*) from public.course_attempt_availability)
     when 'subject_groups' then (select count(*) from public.subject_groups)
     when 'subjects' then (select count(*) from public.subjects)
     when 'syllabus_sections' then (select count(*) from public.syllabus_sections)
     when 'chapters' then (select count(*) from public.chapters)
     when 'source_references' then (select count(*) from public.source_references) end),
  10, 'every shared curriculum table has exactly the rows it had before');
select is((select count(*)::int from public.chapters where status = 'published'), 6, 'no curriculum row changed state');

-- Afterwards ------------------------------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select ca from k), 'select public.delete_my_account()'), 'OK', 'deleting again with the old token is harmless (nothing left to delete)');
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.study_sessions'), '0', 'the old token now sees nothing');
select is(tests.dml_as('authenticated', (select cb from k), 'select public.delete_my_account()'), 'OK', 'B can delete too');
select is((select count(*)::int from public.profiles), 0, 'after both deletions no profile remains');
select is((select count(*)::int from public.courses), 1, 'and the curriculum is still there');
select is((select count(*)::int from public.chapters), 6, 'every chapter included');

select * from finish();
rollback;
