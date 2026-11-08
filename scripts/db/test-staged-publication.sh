#!/usr/bin/env bash
# Staged publication of the REAL CMA Intermediate bundle: Group I first, Group II later. Local Supabase stack only.
#
#   bash scripts/db/test-staged-publication.sh
#
# Runs inside a transaction that is rolled back. The published copies use a TEST-ONLY verifier and are never written
# into the repository. It proves:
#   1. Group I can be published when its complete hierarchy equals the reviewed golden outline (checked BEFORE the
#      availability is enabled),
#   2. Group II stays a draft and is not offered, and the course and December 2026 attempt are offered with Group I only
#      (and a real signed-in student can enrol in Group I but not Group II),
#   3. publishing Group II later exposes it without changing any existing id or stable key,
#   4. both groups are then selectable.
set -euo pipefail
cd "$(dirname "$0")/../.."

export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGDATABASE="${PGDATABASE:-postgres}"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "REFUSED: this test only runs against a local database (PGHOST=$PGHOST)"; exit 2 ;; esac
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/db/build-real-bundle-test-sql.ts "$TMP" >/dev/null

cat > "$TMP/run.sql" <<SQL
begin;
create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as \$\$
begin
  if got is distinct from want then raise exception 'ASSERT FAILED: % (got %, want %)', label, got, want; end if;
end;
\$\$;
create function pg_temp.settle() returns void language plpgsql as \$\$
begin set constraints all immediate; set constraints all deferred; end;
\$\$;
-- runs one statement as a signed-in student (role authenticated, JWT subject = uid): the result, or 'ERR <sqlstate>: <message>'
create function pg_temp.call_as(p_uid uuid, p_sql text) returns text language plpgsql as \$\$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_uid)::text, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
exception when others then
  return 'ERR ' || sqlstate || ': ' || sqlerrm;
end;
\$\$;
-- the published part of the hierarchy, rendered exactly like scripts/curriculum/outline.ts renders the golden outline
create function pg_temp.db_outline() returns text language sql stable as \$f\$
  with w as (select section_id, chapter_id, '[' || published_label || ']' as lbl from public.official_weightages where status = 'published'),
  lines as (
    select array[g.sort_order::int, 0, 0, 0] as k, g.name::text as t
      from public.subject_groups g where g.status = 'published'
    union all
    select array[g.sort_order::int, s.sort_order::int, 0, 0], '  Paper ' || s.paper_number || ': ' || s.name || ' (' || s.short_name || ')'
      from public.subjects s join public.subject_groups g on g.id = s.subject_group_id
     where s.status = 'published' and g.status = 'published'
    union all
    select array[g.sort_order::int, s.sort_order::int, sec.sort_order::int, 0],
           '    ' || sec.official_label || ': ' || sec.title || ' ' || coalesce((select lbl from w where w.section_id = sec.id), '[no individual weight published]')
      from public.syllabus_sections sec join public.subjects s on s.id = sec.subject_id join public.subject_groups g on g.id = s.subject_group_id
     where sec.status = 'published' and s.status = 'published' and g.status = 'published'
    union all
    select array[g.sort_order::int, s.sort_order::int, sec.sort_order::int, c.sequence_no::int],
           '      ' || c.official_label || '. ' || c.title || ' ' || coalesce((select lbl from w where w.chapter_id = c.id), '[no individual weight published]')
      from public.chapters c join public.syllabus_sections sec on sec.id = c.section_id join public.subjects s on s.id = c.subject_id join public.subject_groups g on g.id = s.subject_group_id
     where c.status = 'published' and sec.status = 'published' and s.status = 'published' and g.status = 'published'
  )
  select string_agg(t, E'\n' order by k) from lines;
\$f\$;

\set golden_g1 \`cat $TMP/golden-g1.txt\`
\set golden_all \`cat $TMP/golden-all.txt\`

select pg_temp.assert_eq('starts empty', (select count(*)::text from public.chapters), '0');
insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001', 'stage1@example.invalid'), ('50000000-0000-4000-8000-000000000002', 'stage2@example.invalid'),
  ('50000000-0000-4000-8000-000000000003', 'stage3@example.invalid'), ('50000000-0000-4000-8000-000000000004', 'stage4@example.invalid'),
  ('50000000-0000-4000-8000-000000000005', 'stage5@example.invalid');

-- =============================================================== STAGE 1: Group I published, availability still a draft
\i $TMP/g1-hierarchy.sql
select pg_temp.settle();
create temp table ctx as
  select (select id from public.course_syllabus_versions) as csv,
         (select id from public.exam_attempts where stable_key = 'dec-2026') as att,
         (select id from public.subject_groups where stable_key = 'group-1') as g1,
         (select id from public.subject_groups where stable_key = 'group-2') as g2;
select pg_temp.assert_eq('stage 1: the complete published hierarchy equals the reviewed golden outline for Group I (checked BEFORE enabling availability)', pg_temp.db_outline(), :'golden_g1');
select pg_temp.assert_eq('stage 1: exactly one group is published', (select count(*)::text from public.subject_groups where status = 'published'), '1');
select pg_temp.assert_eq('stage 1: Group I is complete: 34 published modules', (select count(*)::text from public.chapters c join public.subjects s on s.id = c.subject_id join public.subject_groups g on g.id = s.subject_group_id where g.stable_key = 'group-1' and c.status = 'published'), '34');
select pg_temp.assert_eq('stage 1: Group II is untouched: 40 modules, all drafts', (select count(*)::text from public.chapters c join public.subjects s on s.id = c.subject_id join public.subject_groups g on g.id = s.subject_group_id where g.stable_key = 'group-2' and c.status = 'draft'), '40');
select pg_temp.assert_eq('stage 1: the readiness gate passes for a Group I only course', (select public.csv_is_ready(csv)::text from ctx), 'true');
select pg_temp.assert_eq('stage 1: nothing is offered while the availability is a draft', (select count(*)::text from public.enrollment_options), '0');
select pg_temp.assert_eq('stage 1: a student cannot enrol before availability is enabled', (select left(pg_temp.call_as('50000000-0000-4000-8000-000000000001', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])::text', csv, att, g1)), 9) from ctx), 'ERR 23514');

-- =============================================================== STAGE 2: availability enabled, Group I only
\i $TMP/g1-enabled.sql
select pg_temp.settle();
select pg_temp.assert_eq('stage 2: the published hierarchy is still exactly the Group I golden outline', pg_temp.db_outline(), :'golden_g1');
select pg_temp.assert_eq('stage 2: the course and December 2026 attempt are offered', (select course_name || ' | ' || syllabus_name || ' | ' || attempt_label from public.enrollment_options), 'CMA Intermediate | CMA Syllabus 2022 | December 2026');
select pg_temp.assert_eq('stage 2: with Group I ONLY', (select jsonb_array_length(groups)::text || ' ' || (groups -> 0 ->> 'name') from public.enrollment_options), '1 Group I');
select pg_temp.assert_eq('stage 2: Group II is not returned by enrollment_options', (select count(*)::text from public.enrollment_options o, jsonb_array_elements(o.groups) e where e ->> 'name' = 'Group II'), '0');
select pg_temp.assert_eq('stage 2: Group II is still entirely draft', (select count(*)::text from public.chapters c join public.subjects s on s.id = c.subject_id join public.subject_groups g on g.id = s.subject_group_id where g.stable_key = 'group-2' and c.status <> 'draft'), '0');
create temp table ids_before as
  select 'group' k, id, stable_key::text sk from public.subject_groups union all select 'subject', id, stable_key::text from public.subjects
  union all select 'section', id, stable_key::text from public.syllabus_sections union all select 'chapter', id, stable_key::text from public.chapters
  union all select 'weightage', id, stable_key::text from public.official_weightages;
create temp table g1_ids as select * from ids_before where sk like 'ble%' or sk like 'fa-%' or sk like 'ditx%' or sk like 'ca-%' or sk like 'wt-ble%' or sk like 'wt-fa-%' or sk like 'wt-ditx%' or sk like 'wt-ca-%' or sk = 'group-1';
select pg_temp.assert_eq('stage 2: a student can enrol in Group I', (select (pg_temp.call_as('50000000-0000-4000-8000-000000000001', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])::text', csv, att, g1)) not like 'ERR%')::text from ctx), 'true');
select pg_temp.assert_eq('stage 2: a student cannot enrol in the draft Group II', (select left(pg_temp.call_as('50000000-0000-4000-8000-000000000002', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])::text', csv, att, g2)), 9) from ctx), 'ERR 23514');
select pg_temp.assert_eq('stage 2: nor in Group I together with the draft Group II', (select left(pg_temp.call_as('50000000-0000-4000-8000-000000000003', format('select public.create_enrollment(%L, %L, array[%L, %L]::uuid[])::text', csv, att, g1, g2)), 9) from ctx), 'ERR 23514');
select pg_temp.settle();

-- =============================================================== STAGE 3: Group II published later
\i $TMP/g1-g2-enabled.sql
select pg_temp.settle();
select pg_temp.assert_eq('stage 3: no existing id or stable key changed (groups, papers, sections, modules, weightages)', (select count(*)::text from ids_before b join (
    select 'group' k, id, stable_key::text sk from public.subject_groups union all select 'subject', id, stable_key::text from public.subjects
    union all select 'section', id, stable_key::text from public.syllabus_sections union all select 'chapter', id, stable_key::text from public.chapters
    union all select 'weightage', id, stable_key::text from public.official_weightages) a on a.k = b.k and a.id = b.id and a.sk = b.sk), (select count(*)::text from ids_before));
select pg_temp.assert_eq('stage 3: no row was added or removed by publishing Group II', (select count(*)::text from public.chapters) || ' ' || (select count(*)::text from public.subjects) || ' ' || (select count(*)::text from public.official_weightages), '74 8 90');
select pg_temp.assert_eq('stage 3: Group I is still published under the same ids', (select count(*)::text from g1_ids g join public.chapters c on c.id = g.id and c.status = 'published'), (select count(*)::text from g1_ids where sk like '%-c-%' and sk not like 'wt-%'));
select pg_temp.assert_eq('stage 3: the full published hierarchy equals the reviewed golden outline', pg_temp.db_outline(), :'golden_all');
select pg_temp.assert_eq('stage 3: BOTH groups are now returned, in order', (select (select string_agg(e ->> 'name', ',' order by ord) from jsonb_array_elements(o.groups) with ordinality as t(e, ord)) from public.enrollment_options o), 'Group I,Group II');
select pg_temp.assert_eq('stage 3: all 74 modules are published', (select count(*)::text from public.chapters where status = 'published'), '74');
select pg_temp.assert_eq('stage 3: a student can now enrol in Group II alone', (select (pg_temp.call_as('50000000-0000-4000-8000-000000000004', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])::text', csv, att, g2)) not like 'ERR%')::text from ctx), 'true');
select pg_temp.assert_eq('stage 3: or in both groups', (select (pg_temp.call_as('50000000-0000-4000-8000-000000000005', format('select public.create_enrollment(%L, %L, array[%L, %L]::uuid[])::text', csv, att, g1, g2)) not like 'ERR%')::text from ctx), 'true');
select pg_temp.assert_eq('stage 3: the student who was refused Group II can now choose it', (select (pg_temp.call_as('50000000-0000-4000-8000-000000000002', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])::text', csv, att, g2)) not like 'ERR%')::text from ctx), 'true');
select pg_temp.assert_eq('stage 3: the Group I student can add Group II to their enrolment', (select (pg_temp.call_as('50000000-0000-4000-8000-000000000001', format('select ''ok'' from (select public.set_enrollment_groups(%L, array[%L, %L]::uuid[])) as s', e.id, c.g1, c.g2)) = 'ok')::text from ctx c, public.student_enrollments e where e.user_id = '50000000-0000-4000-8000-000000000001'), 'true');
select pg_temp.settle();
select pg_temp.assert_eq('stage 3: the both-groups student really has two groups', (select count(*)::text from public.enrollment_groups where user_id = '50000000-0000-4000-8000-000000000005'), '2');
select 'staged publication: Group I alone, Group II hidden, then both, with every id and stable key unchanged, all OK';
rollback;
SQL

echo "== staged publication test (rolled back) =="
"${PSQL[@]}" -t -A -f "$TMP/run.sql" | grep -v '^$'
left="$("${PSQL[@]}" -t -A -c "select (select count(*) from public.courses) + (select count(*) from public.chapters) + (select count(*) from public.curriculum_import_batches) + (select count(*) from public.source_references) + (select count(*) from auth.users where email like '%@example.invalid')")"
if [ "$left" != "0" ]; then echo "FAIL: $left row(s) persisted after the test"; exit 1; fi
echo "staged publication: nothing persisted (the student-facing dataset is still empty)"
echo "ALL STAGED PUBLICATION CHECKS PASSED"
