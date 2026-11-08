#!/usr/bin/env bash
# Database test for the REAL CMA Intermediate bundle (M5), against the LOCAL Supabase stack only.
#
#   bash scripts/db/test-real-bundle.sh
#
# Everything runs inside a transaction that is rolled back, so no curriculum persists. It proves that the bundle
# as committed (all drafts) is accepted but invisible to students, that a test-only published copy would pass
# the readiness gate, and that re-importing, removing and downgrading behave safely.
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
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as \$\$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ': ' || sqlerrm; end;
\$\$;
\set bad_group \`cat $TMP/bad-group-without-chapters.sql\`

select pg_temp.assert_eq('starts empty', (select count(*)::text from public.chapters), '0');
savepoint empty_database;

-- ---------------------------------------------------------------- the bundle as committed: all drafts
\i $TMP/draft.sql
select pg_temp.settle();
select pg_temp.assert_eq('groups', (select count(*)::text from public.subject_groups), '2');
select pg_temp.assert_eq('subjects (papers 5 to 12)', (select count(*)::text from public.subjects), '8');
select pg_temp.assert_eq('paper numbers', (select string_agg(paper_number::text, ',' order by paper_number) from public.subjects), '5,6,7,8,9,10,11,12');
select pg_temp.assert_eq('sections', (select count(*)::text from public.syllabus_sections), '29');
select pg_temp.assert_eq('chapters (modules)', (select count(*)::text from public.chapters), '74');
select pg_temp.assert_eq('weightages', (select count(*)::text from public.official_weightages), '90');
select pg_temp.assert_eq('section weightages', (select count(*)::text from public.official_weightages where level = 'section'), '29');
select pg_temp.assert_eq('chapter weightages (only where a module has its own published weight)', (select count(*)::text from public.official_weightages where level = 'chapter'), '61');
select pg_temp.assert_eq('no weightage for a module that shares a merged weight cell', (select count(*)::text from public.official_weightages w join public.chapters c on c.id = w.chapter_id where c.stable_key::text in ('ble-c-indian-partnership-act-1932', 'ble-c-factories-act-1948', 'fa-c-lease-accounting', 'ma-c-marginal-costing')), '0');
select pg_temp.assert_eq('no subject-level weightage', (select count(*)::text from public.official_weightages where level = 'subject'), '0');
select pg_temp.assert_eq('each paper section weights sum to 100', (select count(*)::text from (select s.subject_id, sum(w.min_percent) t from public.official_weightages w join public.syllabus_sections s on s.id = w.section_id where w.level = 'section' group by s.subject_id) x where t = 100), '8');
select pg_temp.assert_eq('everything is a draft: groups', (select count(*)::text from public.subject_groups where status <> 'draft'), '0');
select pg_temp.assert_eq('everything is a draft: subjects', (select count(*)::text from public.subjects where status <> 'draft'), '0');
select pg_temp.assert_eq('everything is a draft: chapters', (select count(*)::text from public.chapters where status <> 'draft'), '0');
select pg_temp.assert_eq('everything is a draft: course and syllabus', (select count(*)::text from public.courses where status <> 'draft') || (select count(*)::text from public.syllabus_versions where status <> 'draft') || (select count(*)::text from public.course_syllabus_versions where status <> 'draft'), '000');
select pg_temp.assert_eq('nothing claims a human verified it', (select (select count(*) from public.chapters where verified_by is not null or verified_at is not null) + (select count(*) from public.subjects where verified_by is not null) + (select count(*) from public.subject_groups where verified_by is not null) + (select count(*) from public.official_weightages where verified_by is not null) + (select count(*) from public.exam_attempts where verified_by is not null) + (select count(*) from public.courses where verified_by is not null))::text, '0');
select pg_temp.assert_eq('every curriculum record cites a source', (select (select count(*) from public.chapters where source_reference_id is null) + (select count(*) from public.syllabus_sections where source_reference_id is null) + (select count(*) from public.subjects where source_reference_id is null) + (select count(*) from public.subject_groups where source_reference_id is null) + (select count(*) from public.official_weightages where source_reference_id is null))::text, '0');
select pg_temp.assert_eq('syllabus effective_from stays null (the source gives a term, not a date)', (select count(*)::text from public.syllabus_versions where effective_from is not null), '0');
select pg_temp.assert_eq('no suggested study hours were invented', (select count(*)::text from public.chapters where suggested_study_hours is not null), '0');
select pg_temp.assert_eq('December 2026 attempt carries the official dates', (select exam_start_date::text || ' to ' || exam_end_date::text || ' ' || date_status from public.exam_attempts where stable_key = 'dec-2026'), '2026-12-10 to 2026-12-17 official');
select pg_temp.assert_eq('availability exists but is only a draft', (select string_agg(status, ',') from public.course_attempt_availability), 'draft');
select pg_temp.assert_eq('the combination is NOT ready', (select public.csv_is_ready(id)::text from public.course_syllabus_versions), 'false');
select pg_temp.assert_eq('students are offered nothing', (select count(*)::text from public.enrollment_options), '0');
select pg_temp.assert_eq('no fake record in the real bundle', (select count(*)::text from public.chapters where stable_key::text like 'fake%' or title ilike '%FAKE%'), '0');

-- ---------------------------------------------------------------- idempotent
create temp table ids1 as select id, stable_key::text sk from public.chapters;
\i $TMP/draft.sql
select pg_temp.settle();
select pg_temp.assert_eq('re-import: same chapters', (select count(*)::text from public.chapters), '74');
select pg_temp.assert_eq('re-import: ids unchanged', (select count(*)::text from ids1 i join public.chapters c on c.id = i.id and c.stable_key::text = i.sk), '74');
select pg_temp.assert_eq('re-import: same weightages', (select count(*)::text from public.official_weightages), '90');
select pg_temp.assert_eq('re-import: recorded once', (select count(*)::text from public.curriculum_import_batches), '1');

-- ---------------------------------------------------------------- a TEST-ONLY published copy: the readiness gate passes
\i $TMP/published.sql
select pg_temp.settle();
select pg_temp.assert_eq('published copy: ready', (select public.csv_is_ready(id)::text from public.course_syllabus_versions), 'true');
select pg_temp.assert_eq('published copy: CSV published', (select status from public.course_syllabus_versions), 'published');
select pg_temp.assert_eq('published copy: all 74 chapters published', (select count(*)::text from public.chapters where status = 'published'), '74');
select pg_temp.assert_eq('published copy: ids still unchanged', (select count(*)::text from ids1 i join public.chapters c on c.id = i.id), '74');
select pg_temp.assert_eq('published copy: offered to students', (select count(*)::text from public.enrollment_options), '1');
select pg_temp.assert_eq('published copy: offering is CMA Intermediate / December 2026', (select course_name || ' | ' || syllabus_name || ' | ' || attempt_label from public.enrollment_options), 'CMA Intermediate | CMA Syllabus 2022 | December 2026');
select pg_temp.assert_eq('published copy: both groups offered', (select jsonb_array_length(groups)::text from public.enrollment_options), '2');
select pg_temp.assert_eq('published copy: test verifier recorded', (select verified_by from public.chapters limit 1), 'm5-test-only');

-- ---------------------------------------------------------------- the draft file can never downgrade or un-verify
\i $TMP/draft.sql
select pg_temp.settle();
select pg_temp.assert_eq('draft over published: still published', (select count(*)::text from public.chapters where status = 'published'), '74');
select pg_temp.assert_eq('draft over published: CSV still published', (select status from public.course_syllabus_versions), 'published');
select pg_temp.assert_eq('draft over published: verification kept', (select count(*)::text from public.chapters where verified_by = 'm5-test-only'), '74');
select pg_temp.assert_eq('draft over published: still offered', (select count(*)::text from public.enrollment_options), '1');

-- ---------------------------------------------------------------- removing a chapter retires it, never deletes it
create table public.standin_progress (chapter_id uuid not null references public.chapters (id) on delete restrict);
insert into public.standin_progress select id from public.chapters where stable_key = 'ble-c-factories-act-1948';
\i $TMP/published-minus-one.sql
select pg_temp.settle();
select pg_temp.assert_eq('removed chapter is retired', (select status from public.chapters where stable_key = 'ble-c-factories-act-1948'), 'retired');
select pg_temp.assert_eq('no chapter was deleted', (select count(*)::text from public.chapters), '74');
select pg_temp.assert_eq('73 chapters remain published', (select count(*)::text from public.chapters where status = 'published'), '73');
select pg_temp.assert_eq('student reference intact', (select count(*)::text from public.standin_progress p join public.chapters c on c.id = p.chapter_id and c.status = 'retired'), '1');
select pg_temp.assert_eq('official order stays contiguous after the removal', (select string_agg(sequence_no::text, ',' order by sequence_no) from public.chapters where subject_id = (select id from public.subjects where stable_key = 'ble') and status = 'published'), '1,2,3,4,5,6,7,8,9,10,11,12');

-- ---------------------------------------------------------------- an incomplete published paper is refused by the database
-- Starts again from an empty database: once chapters are published the importer (correctly) never downgrades them.
rollback to savepoint empty_database;
select pg_temp.assert_eq('back to an empty database', (select count(*)::text from public.chapters), '0');
select pg_temp.assert_eq('a published paper without a published chapter is refused', (select left(pg_temp.try_sql(:'bad_group'), 5)), '23514');
select pg_temp.assert_eq('the refusal left nothing behind', (select count(*)::text from public.chapters) || (select count(*)::text from public.courses), '00');
select 'real bundle: draft import, invisibility, idempotency, readiness gate, never-downgrade, retire-not-delete and refusal of incomplete papers all OK';
rollback;
SQL

echo "== real bundle database test (rolled back) =="
"${PSQL[@]}" -t -A -f "$TMP/run.sql" | grep -v '^$'
left="$("${PSQL[@]}" -t -A -c "select (select count(*) from public.courses) + (select count(*) from public.chapters) + (select count(*) from public.curriculum_import_batches) + (select count(*) from public.source_references)")"
if [ "$left" != "0" ]; then echo "FAIL: $left row(s) persisted after the test"; exit 1; fi
echo "real bundle: nothing persisted (the student-facing dataset is still empty)"
echo "ALL REAL BUNDLE DATABASE CHECKS PASSED"
