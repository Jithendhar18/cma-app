-- M3: per-user row quotas (decision U1).
--
-- Why: constraints cap how big a row is, not how many rows a user may create. Without a quota, one signed-in
-- user could insert millions of rows and exhaust the shared free-tier database for everyone.
--
-- How it works
--   * Two PRIVATE tables hold the limits and each user's usage. They have row level security on, no policy and no
--     grant, so they are unreachable through the API. Users cannot read or change their own counters.
--   * AFTER INSERT / AFTER DELETE row triggers (SECURITY DEFINER) keep the counters in the same transaction as the
--     rows, so a rolled-back insert rolls its count back too.
--   * The increment is ONE atomic statement:  INSERT .. ON CONFLICT DO UPDATE .. WHERE used < limit.  The row lock
--     serialises concurrent inserts, and the WHERE refuses to go past the limit. There is never a separate COUNT(*)
--     followed by an insert, so two sessions cannot both slip through the last slot.
--   * AFTER (not BEFORE) INSERT, so an `INSERT .. ON CONFLICT DO NOTHING` retry that inserts nothing consumes
--     nothing. The sync engine relies on idempotent retries, which therefore cannot drift the counter.
--   * Lock order is always "total" first, then the table's own counter, so concurrent sessions cannot deadlock
--     each other across tables.
--   * Account deletion removes the counters through the profile cascade; archiving an enrolment changes nothing,
--     because its rows still exist and still count.
--
-- Covered: every personal table a client can write to (study_sessions, practice_records, planner_sessions, revisions,
-- chapter_progress, mock_tests, local_import_runs) plus student_enrollments (created through a function, but
-- repeatable with replace_active). Not covered, by design: profiles and user_settings (exactly one row per user,
-- created by trigger) and enrollment_groups (changed only through functions and bounded by the number of groups
-- in a syllabus times the enrolment limit).
--
-- Limits (generous: a very heavy user stays far below them; abuse is bounded)
--   study_sessions    20,000  about 1,500 rows per heavy student-year, so roughly 13 years of use
--   practice_records  10,000  about one entry a day plus bulk imports
--   planner_sessions  10,000  about 1,100 a year
--   revisions          8,000  up to 4 live plus cancelled history per chapter; clients cannot delete them
--   chapter_progress   4,000  one row per chapter per enrolment
--   mock_tests          1,000
--   local_import_runs     100
--   student_enrollments    30
--   total (all tables) 50,000
-- At roughly 200 bytes a row plus indexes, the 50,000-row ceiling is about 25 MB, so one account can consume at
-- most about 5% of a 500 MB database. Email confirmation (design decision D3) is the other half of the defence:
-- it limits how many accounts can be created.
-- To change a limit permanently, change it in a migration.

create table public.quota_limits (
  resource text primary key check (resource ~ '^[a-z_]+$'),
  max_rows integer not null check (max_rows > 0)
);

insert into public.quota_limits (resource, max_rows) values
  ('total', 50000),
  ('study_sessions', 20000),
  ('practice_records', 10000),
  ('planner_sessions', 10000),
  ('revisions', 8000),
  ('chapter_progress', 4000),
  ('mock_tests', 1000),
  ('local_import_runs', 100),
  ('student_enrollments', 30);

create table public.user_quota_usage (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  resource   text not null references public.quota_limits (resource),
  used       integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, resource)
);

-- Private: RLS on, and deliberately no policy and no grant.
alter table public.quota_limits     enable row level security;
alter table public.user_quota_usage enable row level security;
revoke all on public.quota_limits     from public, anon, authenticated;
revoke all on public.user_quota_usage from public, anon, authenticated;

-- Atomically takes one slot, or refuses. Internal.
create function public.quota_take(p_user uuid, p_resource text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_allowed integer;
  new_used integer;
begin
  select max_rows into max_allowed from public.quota_limits where resource = p_resource;
  if max_allowed is null then
    raise exception 'unknown quota resource %', p_resource using errcode = '22023';
  end if;

  insert into public.user_quota_usage as u (user_id, resource, used)
    values (p_user, p_resource, 1)
  on conflict (user_id, resource) do update
    set used = u.used + 1, updated_at = clock_timestamp()
    where u.used < max_allowed
  returning u.used into new_used;

  -- the WHERE refused the update: the user is already at the limit
  if new_used is null then
    raise exception 'quota exceeded for %: the limit is % rows per account', p_resource, max_allowed
      using errcode = 'P0429', hint = 'QUOTA_EXCEEDED',
            detail = format('resource=%s limit=%s', p_resource, max_allowed);
  end if;
end;
$$;

create function public.quota_consume()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- fixed lock order (total, then the table's own counter) so concurrent sessions cannot deadlock
  perform public.quota_take(new.user_id, 'total');
  perform public.quota_take(new.user_id, tg_table_name);
  return null;
end;
$$;

create function public.quota_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- two statements, in the same fixed order as quota_consume. During an account deletion the counters may already
  -- be gone; updating zero rows is fine.
  update public.user_quota_usage set used = greatest(used - 1, 0), updated_at = clock_timestamp()
   where user_id = old.user_id and resource = 'total';
  update public.user_quota_usage set used = greatest(used - 1, 0), updated_at = clock_timestamp()
   where user_id = old.user_id and resource = tg_table_name;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'study_sessions', 'practice_records', 'planner_sessions', 'revisions', 'chapter_progress',
    'mock_tests', 'local_import_runs', 'student_enrollments'
  ] loop
    execute format('create trigger %I after insert on public.%I for each row execute function public.quota_consume()', t || '_quota_insert', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.quota_release()', t || '_quota_delete', t);
  end loop;
end;
$$;

-- Maintenance and tests: compares every counter with the real row counts. Returns only mismatches, so an empty
-- result means the counters are exactly right. Not granted to API roles.
create function public.quota_audit()
returns table (user_id uuid, resource text, recorded integer, actual integer)
language sql
stable
set search_path = ''
as $$
  with per_table as (
    select s.user_id, 'study_sessions'::text as resource, count(*)::int as n from public.study_sessions s group by s.user_id
    union all select p.user_id, 'practice_records', count(*)::int from public.practice_records p group by p.user_id
    union all select p.user_id, 'planner_sessions', count(*)::int from public.planner_sessions p group by p.user_id
    union all select r.user_id, 'revisions', count(*)::int from public.revisions r group by r.user_id
    union all select c.user_id, 'chapter_progress', count(*)::int from public.chapter_progress c group by c.user_id
    union all select m.user_id, 'mock_tests', count(*)::int from public.mock_tests m group by m.user_id
    union all select l.user_id, 'local_import_runs', count(*)::int from public.local_import_runs l group by l.user_id
    union all select e.user_id, 'student_enrollments', count(*)::int from public.student_enrollments e group by e.user_id
  ), actual as (
    select pt.user_id, pt.resource, pt.n from per_table pt
    union all
    select pt.user_id, 'total', sum(pt.n)::int from per_table pt group by pt.user_id
  )
  select coalesce(a.user_id, q.user_id), coalesce(a.resource, q.resource), coalesce(q.used, 0), coalesce(a.n, 0)
    from actual a
    full join public.user_quota_usage q on q.user_id = a.user_id and q.resource = a.resource
   where coalesce(q.used, 0) <> coalesce(a.n, 0)
$$;

-- What a signed-in user may see: their OWN usage and the limits. Read-only, derived from auth.uid() (never a
-- parameter), so it is useful for a "you have used X of Y" message without opening the private tables.
create function public.get_my_quota()
returns table (resource text, used integer, max_rows integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.resource, coalesce(u.used, 0), l.max_rows
    from public.quota_limits l
    left join public.user_quota_usage u on u.resource = l.resource and u.user_id = auth.uid()
   order by l.resource
$$;

revoke all on function public.quota_take(uuid, text)  from public, anon, authenticated;
revoke all on function public.quota_consume()         from public, anon, authenticated;
revoke all on function public.quota_release()         from public, anon, authenticated;
revoke all on function public.quota_audit()           from public, anon, authenticated;
revoke all on function public.get_my_quota()          from public, anon, authenticated;
grant execute on function public.get_my_quota() to authenticated;
