-- M1: default deny. The database must be closed unless a migration explicitly opens something.
begin;
select plan(15);

-- A brand new object created by the migration role must start with NO access for the API roles.
create table public.probe_table (id int);
create sequence public.probe_seq;
create function public.probe_fn() returns int language sql as 'select 1';

select ok(not has_table_privilege('anon', 'public.probe_table', 'select'),         'new table: anon cannot select');
select ok(not has_table_privilege('anon', 'public.probe_table', 'insert'),         'new table: anon cannot insert');
select ok(not has_table_privilege('authenticated', 'public.probe_table', 'select'), 'new table: authenticated cannot select');
select ok(not has_table_privilege('authenticated', 'public.probe_table', 'insert'), 'new table: authenticated cannot insert');
select ok(not has_sequence_privilege('authenticated', 'public.probe_seq', 'usage'), 'new sequence: authenticated cannot use');
select ok(not has_function_privilege('anon', 'public.probe_fn()', 'execute'),       'new function: anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.probe_fn()', 'execute'), 'new function: authenticated cannot execute');
-- The global PUBLIC default is the subtle one. A NULL ACL means "defaults" (PUBLIC can execute) and an
-- aclitem starting with "=" is a grant to PUBLIC. Neither may be present.
select ok(
  (select proacl is not null and proacl::text !~ '(^\{|,)=' from pg_proc where proname = 'probe_fn'),
  'new function: PUBLIC cannot execute');

-- Every table in public has row level security on (a guard that also covers future tables).
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      and c.relname <> 'probe_table'),
  0, 'every real public table has RLS enabled');

-- anon has no table privileges at all in public (other than the probe, which has none).
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0, 'anon holds no table privilege in public');

-- Nothing grants the dangerous privileges, on any table, to the API roles.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'no API role can TRUNCATE, REFERENCE or add triggers on any public table');

-- The shared curriculum is strictly read-only for signed-in users.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
      and table_name in ('source_references','curriculum_import_batches','courses','syllabus_versions','course_syllabus_versions','exam_attempts','course_attempt_availability','subject_groups','subjects','syllabus_sections','chapters','official_weightages','study_resources')),
  0, 'authenticated holds only SELECT on the shared curriculum tables');

-- Personal tables: an exact allow-list. Anything not listed is not granted.
select is(
  (select string_agg(table_name || ':' || privs, ' ' order by table_name) from (
     select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated'
        and table_name not in ('source_references','curriculum_import_batches','courses','syllabus_versions','course_syllabus_versions','exam_attempts','course_attempt_availability','subject_groups','subjects','syllabus_sections','chapters','official_weightages','study_resources')
      group by table_name) g),
  'chapter_progress:DELETE,INSERT,SELECT,UPDATE chapter_stats:SELECT daily_study_minutes:SELECT enrollment_groups:SELECT enrollment_options:SELECT '
  || 'local_import_runs:INSERT,SELECT mock_tests:DELETE,INSERT,SELECT,UPDATE planner_sessions:DELETE,INSERT,SELECT,UPDATE '
  || 'practice_records:DELETE,INSERT,SELECT,UPDATE profiles:SELECT revisions:INSERT,SELECT,UPDATE '
  || 'student_enrollments:SELECT study_sessions:DELETE,INSERT,SELECT,UPDATE user_settings:SELECT',
  'personal tables and views: exactly the intended table privileges (revisions cannot be deleted; enrolments and profiles are read-only at table level)');

-- Callable functions: the readiness check, the enrolment functions and account deletion. Nothing else.
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'probe_fn'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or p.proacl is null)),
  array['activate_enrollment', 'archive_enrollment', 'change_enrollment_attempt', 'create_enrollment', 'csv_is_ready',
        'delete_my_account', 'get_my_quota', 'set_enrollment_groups'],
  'only the readiness check, the enrolment functions, account deletion and the read-only quota view are executable by API roles');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon can execute no public function at all');

select * from finish();
rollback;
