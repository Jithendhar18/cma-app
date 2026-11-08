-- M3 (U1): per-user row quotas. Private counters, atomic and transactional, no bypass through the API.
-- Concurrency (separate sessions racing for the last slot) cannot be tested inside one transaction; see
-- scripts/db/test-committed.sh.
begin;
select tests.build_personal_fixture();
select plan(82);

create temp table k on commit drop as select
  '11111111-1111-4111-8111-111111111111'::uuid as ua, '22222222-2222-4222-8222-222222222222'::uuid as ub,
  tests.claims('11111111-1111-4111-8111-111111111111') as ca, tests.claims('22222222-2222-4222-8222-222222222222') as cb,
  tests.claims_password_age('11111111-1111-4111-8111-111111111111', 0) as ca_fresh,
  'aaaaaaaa-0000-4000-8000-0000000000e1'::uuid as ea,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.chapters where stable_key = 'fake-ch-1') as ch1,
  (select id from public.subjects where stable_key = 'fake-subject-1') as subj1,
  (select id from public.exam_attempts where stable_key = 'fake-attempt-a') as att_a,
  (select id from public.subject_groups where stable_key = 'fake-group-1') as g1;

create function pg_temp.used(p_user uuid, p_resource text) returns int language sql
  as $$ select coalesce((select used from public.user_quota_usage where user_id = p_user and resource = p_resource), 0) $$;
create function pg_temp.rows_of(p_user uuid) returns int language sql
  as $$ select (select count(*) from public.study_sessions where user_id = p_user)::int $$;
create function pg_temp.study_sql(p_n int, p_tag text) returns text language sql stable as $$
  select format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
                   select %L || '-' || gen_random_uuid()::text, %L, %L, %L, %L, '2090-05-01', 10, 'pomodoro' from generate_series(1, %s)$q$,
                p_tag, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k), p_n) $$;
create function pg_temp.study_for_b_sql(p_tag text) returns text language sql stable as $$
  select format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
                   values (%L || '-' || gen_random_uuid()::text, %L, 'bbbbbbbb-0000-4000-8000-0000000000e1', %L, %L, '2090-05-01', 10, 'pomodoro')$q$,
                p_tag, (select ub from k), (select csv1 from k), (select ch1 from k)) $$;

-- ==================================================== the counters are private
select ok((select relrowsecurity from pg_class where oid = 'public.user_quota_usage'::regclass), 'usage table: RLS is on');
select ok((select relrowsecurity from pg_class where oid = 'public.quota_limits'::regclass), 'limits table: RLS is on');
select is((select count(*)::int from pg_policies where tablename in ('user_quota_usage', 'quota_limits')), 0, 'neither table has any policy');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['public.user_quota_usage', 'public.quota_limits']) t, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
                       where has_table_privilege(r, t, p)), 'neither API role holds any privilege on either table');
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.user_quota_usage'), 'ERR:42501', 'a user cannot read the counters');
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.quota_limits'), 'ERR:42501', 'nor the limits table');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.user_quota_usage'), 'ERR:42501', 'anon cannot read the counters');
select is(tests.dml_as('authenticated', (select ca from k), format($q$update public.user_quota_usage set used = 0 where user_id = %L$q$, (select ua from k))), '42501', 'a user cannot reset their own counter');
select is(tests.dml_as('authenticated', (select ca from k), $$update public.user_quota_usage set used = 0$$), '42501', 'not even with an unconditional update');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.user_quota_usage (user_id, resource, used) values (%L, 'study_sessions', 0) on conflict (user_id, resource) do update set used = 0$q$, (select ua from k))), '42501', 'nor overwrite it with an upsert');
select is(tests.dml_as('authenticated', (select ca from k), 'delete from public.user_quota_usage'), '42501', 'nor delete it');
select is(tests.dml_as('authenticated', (select ca from k), $$update public.quota_limits set max_rows = 2000000000$$), '42501', 'nor raise a limit');

-- ==================================================== baseline: the counters match reality
select is((select count(*)::int from public.quota_audit()), 0, 'after the fixture, every counter equals the real row count');
select is(pg_temp.used((select ua from k), 'study_sessions'), 4, 'A has 4 study sessions counted');
select is(pg_temp.used((select ua from k), 'total'), 17, 'A''s total is 17 rows across all tables');
select is(pg_temp.used((select ub from k), 'total'), 9, 'B''s total is 9');
select is((select string_agg(resource || '=' || max_rows, ' ' order by resource) from public.quota_limits),
  'chapter_progress=4000 local_import_runs=100 mock_tests=1000 planner_sessions=10000 practice_records=10000 revisions=8000 student_enrollments=30 study_sessions=20000 total=50000',
  'the limits are exactly the documented ones');

-- ==================================================== increments, decrements, no drift
select is(tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(1, 'one')), 'OK', 'an authenticated user can insert (the definer trigger can reach the private counters)');
select is(pg_temp.used((select ua from k), 'study_sessions'), 5, 'the table counter went up by 1');
select is(pg_temp.used((select ua from k), 'total'), 18, 'and the total went up by 1');
select is(tests.dml_as('authenticated', (select ca from k), format($q$delete from public.study_sessions where id = (select id from public.study_sessions where user_id = %L order by created_at desc limit 1)$q$, (select ua from k))), 'OK', 'delete one row');
select is(pg_temp.used((select ua from k), 'study_sessions'), 4, 'the table counter went back down');
select is(pg_temp.used((select ua from k), 'total'), 17, 'and the total');
select is(tests.dml_as('authenticated', (select ca from k), format($q$update public.study_sessions set notes = 'edited' where user_id = %L$q$, (select ua from k))), 'OK', 'updating rows ...');
select is(pg_temp.used((select ua from k), 'total'), 17, '... does not change the counters');

-- the sync engine retries inserts with ON CONFLICT DO NOTHING: that must consume nothing
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-focus-a2', %L, %L, %L, %L, '2090-01-10', 25, 'stopwatch') on conflict (user_id, client_id) do nothing$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k))), 'OK', 'a retried insert (ON CONFLICT DO NOTHING) is accepted');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-focus-a2', %L, %L, %L, %L, '2090-01-10', 25, 'stopwatch') on conflict (user_id, client_id) do nothing$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k))), 'OK', 'and again');
select is(pg_temp.used((select ua from k), 'total'), 17, 'the retries consumed no quota (an AFTER trigger fires only for rows really inserted)');
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-focus-a2', %L, %L, %L, %L, '2090-01-10', 25, 'stopwatch') on conflict (user_id, client_id) do update set minutes = excluded.minutes$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k))), 'OK', 'an upsert that updates an existing row ...');
select is(pg_temp.used((select ua from k), 'total'), 17, '... consumes nothing either');
select is((select count(*)::int from public.quota_audit()), 0, 'counters still exactly match reality');

-- ==================================================== bulk inserts
select is(tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(10, 'bulk')), 'OK', 'a bulk insert of 10 rows');
select is(pg_temp.used((select ua from k), 'study_sessions'), 14, 'counts exactly 10 more');
select is((select count(*)::int from public.quota_audit()), 0, 'and stays consistent');

-- ==================================================== the boundary
update public.quota_limits set max_rows = 16 where resource = 'study_sessions';
select is(tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(2, 'edge')), 'OK', 'two inserts fit up to the limit (16)');
select is(pg_temp.used((select ua from k), 'study_sessions'), 16, 'the counter is exactly at the limit');
select is(tests.diag_as('authenticated', (select ca from k), pg_temp.study_sql(1, 'over')), 'P0429|quota exceeded for study_sessions: the limit is 16 rows per account|QUOTA_EXCEEDED', 'the next insert is refused with a clear, structured error');
select is(pg_temp.rows_of((select ua from k)), 16, 'the refused insert left no row behind');
select is(pg_temp.used((select ua from k), 'study_sessions'), 16, 'and did not move the counter');
select is(pg_temp.used((select ua from k), 'total'), 29, 'nor the total (the failed statement rolled everything back)');

-- a bulk insert that would cross the boundary fails as a whole
select is(tests.dml_as('authenticated', (select ca from k), format($q$delete from public.study_sessions where id in (select id from public.study_sessions where user_id = %L and client_id like 'bulk-%%' limit 3)$q$, (select ua from k))), 'OK', 'free three slots');
select is(pg_temp.used((select ua from k), 'study_sessions'), 13, 'now 13 of 16');
select is(tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(10, 'toomany')), 'P0429', 'a bulk insert of 10 would cross the limit and is refused');
select is(pg_temp.rows_of((select ua from k)), 13, 'none of its rows were inserted (the statement is atomic)');
select is(pg_temp.used((select ua from k), 'study_sessions'), 13, 'and the counter did not move');
select is(tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(3, 'exact')), 'OK', 'a bulk insert that lands exactly on the limit succeeds');
select is(pg_temp.used((select ua from k), 'study_sessions'), 16, 'at the limit again');
select is(tests.dml_as('authenticated', (select ca from k), format($q$delete from public.study_sessions where id in (select id from public.study_sessions where user_id = %L limit 1)$q$, (select ua from k))), 'OK', 'deleting one frees a slot ...');
select is(tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(1, 'again')), 'OK', '... and an insert works again');

-- ==================================================== the aggregate limit
update public.quota_limits set max_rows = 20000 where resource = 'study_sessions';
update public.quota_limits set max_rows = pg_temp.used((select ua from k), 'total') + 1 where resource = 'total';
select is(tests.dml_as('authenticated', (select ca from k), format($q$insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
  values ('agg-1', %L, %L, %L, %L, '2090-05-01', 5, 5)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select ch1 from k))), 'OK', 'the last slot of the aggregate limit can be used');
select matches(tests.diag_as('authenticated', (select ca from k), format($q$insert into public.mock_tests (client_id, user_id, enrollment_id, csv_id, subject_id, taken_on, name, score, max_score)
  values ('agg-2', %L, %L, %L, %L, '2090-05-01', 'x', 1, 2)$q$, (select ua from k), (select ea from k), (select csv1 from k), (select subj1 from k))), '^P0429[|]quota exceeded for total:', 'any other table is then refused, naming the aggregate limit');
select is(pg_temp.used((select ua from k), 'mock_tests'), 1, 'the refused row did not leave its table counter incremented');
select is(tests.dml_as('authenticated', tests.claims('22222222-2222-4222-8222-222222222222'), pg_temp.study_for_b_sql('b')), 'OK', 'another user is unaffected by A being at the limit (usage is per user)');
update public.quota_limits set max_rows = 50000 where resource = 'total';

-- ==================================================== transactions
select pg_temp.used((select ua from k), 'total') as before_total \gset
savepoint before_rollback;
select tests.dml_as('authenticated', (select ca from k), pg_temp.study_sql(5, 'rolled'));
select is(pg_temp.used((select ua from k), 'total'), :before_total + 5, 'five rows inserted inside a savepoint are counted ...');
rollback to savepoint before_rollback;
select is(pg_temp.used((select ua from k), 'total'), :before_total, '... and a rollback gives the counts back with the rows');
select is((select count(*)::int from public.quota_audit()), 0, 'counters match reality after the rollback');

-- ==================================================== enrolment archival and the enrolment limit
select pg_temp.used((select ua from k), 'student_enrollments') as enr_before \gset
select is(tests.dml_as('authenticated', (select ca from k), format('select public.archive_enrollment(%L)', (select ea from k))), 'OK', 'archive A''s active enrolment');
select is(pg_temp.used((select ua from k), 'student_enrollments'), :enr_before, 'archiving frees nothing: its rows still exist and still count');
update public.quota_limits set max_rows = pg_temp.used((select ua from k), 'student_enrollments') where resource = 'student_enrollments';
select is(tests.dml_as('authenticated', (select ca from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[], true)', (select csv1 from k), (select att_a from k), (select g1 from k))), 'P0429', 'creating enrolments is quota-limited too (replace_active cannot be repeated forever)');
select is((select count(*)::int from public.student_enrollments where user_id = (select ua from k)), :enr_before, 'the refused call created no enrolment');
update public.quota_limits set max_rows = 30 where resource = 'student_enrollments';

-- ==================================================== no bypass through the normal API
select is(tests.dml_as('authenticated', (select ca from k), format('select public.quota_take(%L, %L)', (select ua from k), 'total')), '42501', 'the internal increment function is not callable');
select is(tests.dml_as('authenticated', (select ca from k), 'select * from public.quota_audit()'), '42501', 'nor the audit');
select is(tests.dml_as('authenticated', (select ca from k), 'set session_replication_role = replica'), '42501', 'a user cannot switch triggers off with session_replication_role');
select is(tests.dml_as('authenticated', (select ca from k), 'alter table public.study_sessions disable trigger all'), '42501', 'nor disable triggers on a table');
select is(tests.dml_as('authenticated', (select ca from k), 'drop trigger study_sessions_quota_insert on public.study_sessions'), '42501', 'nor drop the quota trigger');
select is(tests.dml_as('authenticated', (select ca from k), 'truncate public.study_sessions'), '42501', 'nor truncate a table to dodge the decrement');
select is(tests.dml_as('authenticated', (select ca from k), 'create function public.quota_take(uuid, text) returns void language sql as $$ select $$'), '42501', 'nor replace the increment function');
select is(tests.dml_as('authenticated', (select ca from k), format($q$update public.study_sessions set user_id = %L$q$, (select ub from k))), '23514', 'nor push their rows onto another user''s count (user_id is immutable)');

-- ==================================================== what a user may see of their own usage
select is(tests.value_as('authenticated', (select ca from k), 'select count(*) from public.get_my_quota()'), '9', 'a user sees all nine limits');
select is(tests.value_as('authenticated', (select ca from k), $$select used from public.get_my_quota() where resource = 'total'$$), pg_temp.used((select ua from k), 'total')::text, 'with their own usage');
select isnt(tests.value_as('authenticated', tests.claims('22222222-2222-4222-8222-222222222222'), $$select used from public.get_my_quota() where resource = 'total'$$), pg_temp.used((select ua from k), 'total')::text, 'another user sees their own, different, usage');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.get_my_quota()'), 'ERR:42501', 'anon cannot call it');
select is((select pronargs::int from pg_proc where proname = 'get_my_quota'), 0, 'it takes no user parameter: only the caller''s own usage is ever returned');

-- ==================================================== every writable personal table is covered
select is(
  (select array_agg(c.table_name::text order by c.table_name) from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'user_id'
      and c.table_name not in (select event_object_table from information_schema.triggers where trigger_name like '%\_quota\_insert' and trigger_schema = 'public')),
  array['enrollment_groups', 'user_quota_usage', 'user_settings'],
  'the only tables with a user_id and no quota trigger are the documented exceptions (function-managed or one-row-per-user, or the counters themselves)');
select is((select count(*)::int from information_schema.triggers where trigger_schema = 'public' and trigger_name like '%\_quota\_insert'), 8, 'eight tables count inserts');
select is((select count(*)::int from information_schema.triggers where trigger_schema = 'public' and trigger_name like '%\_quota\_delete'), 8, 'and the same eight release on delete');

-- ==================================================== account deletion
select is((select count(*)::int from public.quota_audit()), 0, 'before deletion, all counters are exact');
select is(tests.dml_as('authenticated', (select ca_fresh from k), 'select public.delete_my_account()'), 'OK', 'A deletes their account (fresh password authentication)');
select is((select count(*)::int from public.user_quota_usage where user_id = (select ua from k)), 0, 'A''s counters are gone with the account');
select is((select count(*)::int from public.user_quota_usage where user_id = (select ub from k)), 9, 'B''s counters are intact (eight tables plus the total)');
select is((select count(*)::int from public.user_quota_usage u where not exists (select 1 from public.profiles p where p.id = u.user_id)), 0, 'no orphaned counters remain');
select is((select count(*)::int from public.quota_audit()), 0, 'every remaining counter still equals the real row count');

select * from finish();
rollback;
