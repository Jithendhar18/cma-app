-- M1: default deny. The database must be closed unless a migration explicitly opens something.
begin;
select plan(12);

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

-- authenticated holds only SELECT on tables (no write, truncate, references or trigger).
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'),
  0, 'authenticated holds only SELECT on public tables');

-- The only public function the API roles can run is the readiness function.
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'probe_fn'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or p.proacl is null)),
  array['csv_is_ready'],
  'only csv_is_ready is executable by API roles');

select * from finish();
rollback;
