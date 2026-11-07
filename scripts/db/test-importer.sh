#!/usr/bin/env bash
# Database integration test for the curriculum importer, using the FAKE fixture.
# Requires the local Supabase stack to be running (it never touches a hosted project).
#
#   bash scripts/db/test-importer.sh
#
# Everything runs inside transactions that are rolled back, so the fixture never persists.
set -euo pipefail
cd "$(dirname "$0")/../.."

export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGDATABASE="${PGDATABASE:-postgres}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/db/build-import-test-sql.ts "$TMP" >/dev/null

# Refuse to run against anything that is not the local stack.
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "REFUSED: importer test only runs against a local database (PGHOST=$PGHOST)"; exit 2 ;; esac

cat > "$TMP/run.sql" <<SQL
begin;
create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as \$\$
begin
  if got is distinct from want then
    raise exception 'ASSERT FAILED: % (got %, want %)', label, got, want;
  end if;
end;
\$\$;
-- simulate COMMIT: check the deferrable ordering constraints, then defer them again for the next import
create function pg_temp.settle() returns void language plpgsql as \$\$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
\$\$;

-- runs a whole generated file as ONE unit: 'OK', or the error. A failure rolls the file back completely.
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as \$\$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
\$\$;
\set retire_all_denied \`cat $TMP/retire-all-denied.sql\`
\set retire_all_allowed \`cat $TMP/retire-all-allowed.sql\`
\set late_failure \`cat $TMP/bad-late-failure.sql\`

-- ---------------------------------------------------------------- v1 into an empty database
select pg_temp.assert_eq('starts empty', (select count(*)::text from public.chapters), '0');
\i $TMP/v1.sql
select pg_temp.settle();
select pg_temp.assert_eq('v1 chapters', (select count(*)::text from public.chapters), '5');
select pg_temp.assert_eq('v1 subjects', (select count(*)::text from public.subjects), '3');
select pg_temp.assert_eq('v1 groups', (select count(*)::text from public.subject_groups), '2');
select pg_temp.assert_eq('v1 sections', (select count(*)::text from public.syllabus_sections), '2');
select pg_temp.assert_eq('v1 weightages', (select count(*)::text from public.official_weightages), '1');
select pg_temp.assert_eq('v1 resources', (select count(*)::text from public.study_resources), '2');
select pg_temp.assert_eq('v1 attempts', (select count(*)::text from public.exam_attempts), '3');
select pg_temp.assert_eq('v1 csv published', (select status from public.course_syllabus_versions), 'published');
select pg_temp.assert_eq('v1 availability enabled', (select count(*)::text from public.course_attempt_availability where status = 'enabled'), '2');
select pg_temp.assert_eq('v1 draft attempt not offered', (select count(*)::text from public.course_attempt_availability a join public.exam_attempts e on e.id = a.exam_attempt_id where e.stable_key = 'fake-attempt-c'), '0');
select pg_temp.assert_eq('v1 exam dates stay null', (select count(*)::text from public.exam_attempts where exam_start_date is not null), '0');
select pg_temp.assert_eq('v1 no derived chapter weightage', (select count(*)::text from public.official_weightages where level = 'chapter'), '0');
select pg_temp.assert_eq('v1 one audit batch', (select count(*)::text from public.curriculum_import_batches), '1');

-- ---------------------------------------------------------------- idempotent: v1 again changes nothing
create temp table snap1 as select 'ch' k, id, stable_key::text, title, sequence_no::text v, status, updated_at::text u from public.chapters
  union all select 'subj', id, stable_key::text, name, sort_order::text, status, updated_at::text from public.subjects
  union all select 'res', id, stable_key::text, url, link_status, status, updated_at::text from public.study_resources;
\i $TMP/v1.sql
select pg_temp.settle();
select pg_temp.assert_eq('re-import keeps chapter count', (select count(*)::text from public.chapters), '5');
select pg_temp.assert_eq('re-import keeps subject count', (select count(*)::text from public.subjects), '3');
select pg_temp.assert_eq('re-import keeps resource count', (select count(*)::text from public.study_resources), '2');
select pg_temp.assert_eq('re-import keeps weightage count', (select count(*)::text from public.official_weightages), '1');
select pg_temp.assert_eq('re-import keeps attempt count', (select count(*)::text from public.exam_attempts), '3');
select pg_temp.assert_eq('re-import: ids unchanged', (select count(*)::text from snap1 s join public.chapters c on c.id = s.id and c.stable_key::text = s.stable_key where s.k = 'ch'), '5');
select pg_temp.assert_eq('re-import: content unchanged',
  (select count(*)::text from snap1 s join public.chapters c on c.id = s.id and c.title = s.title and c.sequence_no::text = s.v and c.status = s.status where s.k = 'ch'), '5');
select pg_temp.assert_eq('re-import: same bundle recorded once', (select count(*)::text from public.curriculum_import_batches), '1');

-- ---------------------------------------------------------------- stand-in for student progress: points at a chapter v2 will retire
create table public.standin_progress (chapter_id uuid not null references public.chapters (id) on delete restrict);
insert into public.standin_progress select id from public.chapters where stable_key = 'fake-ch-3';
create temp table ids_before as select id, stable_key::text sk from public.chapters;

-- ---------------------------------------------------------------- v2: update in place, retire, add
\i $TMP/v2.sql
select pg_temp.settle();
select pg_temp.assert_eq('v2: rename applied in place', (select title from public.chapters where stable_key = 'fake-ch-1'), 'FAKE Chapter 1 (renamed)');
select pg_temp.assert_eq('v2: ids never change', (select count(*)::text from ids_before b join public.chapters c on c.id = b.id and c.stable_key::text = b.sk), '5');
select pg_temp.assert_eq('v2: official order swapped',
  (select string_agg(stable_key::text, ',' order by sequence_no) from public.chapters where subject_id = (select id from public.subjects where stable_key = 'fake-subject-1') and status = 'published'),
  'fake-ch-2,fake-ch-1');
select pg_temp.assert_eq('v2: removed chapter is retired, not deleted', (select status from public.chapters where stable_key = 'fake-ch-3'), 'retired');
select pg_temp.assert_eq('v2: retired chapter still exists', (select count(*)::text from public.chapters where stable_key = 'fake-ch-3'), '1');
select pg_temp.assert_eq('v2: student reference still valid', (select count(*)::text from public.standin_progress p join public.chapters c on c.id = p.chapter_id), '1');
select pg_temp.assert_eq('v2: new chapter added', (select status from public.chapters where stable_key = 'fake-ch-6'), 'published');
select pg_temp.assert_eq('v2: total chapters (5 + 1 new, none deleted)', (select count(*)::text from public.chapters), '6');
select pg_temp.assert_eq('v2: link updated in place', (select url from public.study_resources where stable_key = 'fake-resource-1'), 'https://example.invalid/fake-mcq-moved');
select pg_temp.assert_eq('v2: weightage updated', (select min_percent::text from public.official_weightages where stable_key = 'fake-weightage-section-a'), '25.00');
select pg_temp.assert_eq('v2: attempt B no longer offered (disabled, row kept)', (select a.status from public.course_attempt_availability a join public.exam_attempts e on e.id = a.exam_attempt_id where e.stable_key = 'fake-attempt-b'), 'disabled');
select pg_temp.assert_eq('v2: attempt A still enabled', (select a.status from public.course_attempt_availability a join public.exam_attempts e on e.id = a.exam_attempt_id where e.stable_key = 'fake-attempt-a'), 'enabled');
select pg_temp.assert_eq('v2: CSV still published', (select status from public.course_syllabus_versions), 'published');
select pg_temp.assert_eq('v2: second audit batch', (select count(*)::text from public.curriculum_import_batches), '2');

-- ---------------------------------------------------------------- rollback by re-importing v1: values restored, retired chapter returns
\i $TMP/v1.sql
select pg_temp.settle();
select pg_temp.assert_eq('rollback: title restored', (select title from public.chapters where stable_key = 'fake-ch-1'), 'FAKE Chapter 1');
select pg_temp.assert_eq('rollback: order restored',
  (select string_agg(stable_key::text, ',' order by sequence_no) from public.chapters where subject_id = (select id from public.subjects where stable_key = 'fake-subject-1') and status = 'published'),
  'fake-ch-1,fake-ch-2,fake-ch-3');
select pg_temp.assert_eq('rollback: retired chapter published again', (select status from public.chapters where stable_key = 'fake-ch-3'), 'published');
select pg_temp.assert_eq('rollback: v2-only chapter is retired, not deleted', (select status from public.chapters where stable_key = 'fake-ch-6'), 'retired');
select pg_temp.assert_eq('rollback: link restored', (select url from public.study_resources where stable_key = 'fake-resource-1'), 'https://example.invalid/fake-mcq');
select pg_temp.assert_eq('rollback: attempt B offered again', (select a.status from public.course_attempt_availability a join public.exam_attempts e on e.id = a.exam_attempt_id where e.stable_key = 'fake-attempt-b'), 'enabled');
select pg_temp.assert_eq('rollback: no chapter ever deleted', (select count(*)::text from public.chapters), '6');
select pg_temp.assert_eq('rollback: student reference intact', (select count(*)::text from public.standin_progress p join public.chapters c on c.id = p.chapter_id), '1');
-- ---------------------------------------------------------------- a draft entry never unpublishes or un-verifies
select pg_temp.assert_eq('before v3: chapter 2 is verified', (select (verified_at is not null)::text from public.chapters where stable_key = 'fake-ch-2'), 'true');
\i $TMP/v3-draft-over-published.sql
select pg_temp.settle();
select pg_temp.assert_eq('v3: a draft entry does not unpublish', (select status from public.chapters where stable_key = 'fake-ch-2'), 'published');
select pg_temp.assert_eq('v3: a draft entry does not erase verification', (select (verified_at is not null and source_reference_id is not null)::text from public.chapters where stable_key = 'fake-ch-2'), 'true');
select pg_temp.assert_eq('v3: a draft entry does not erase the recorded verifier', (select verified_by from public.chapters where stable_key = 'fake-ch-2'), 'fake-maintainer');
select pg_temp.assert_eq('v3: other fields still update', (select title from public.chapters where stable_key = 'fake-ch-2'), 'FAKE Chapter 2 (edited while draft)');
-- ---------------------------------------------------------------- verification repeated explicitly replaces the verifier
select pg_temp.assert_eq('before v4: chapter 1 verifier', (select verified_by from public.chapters where stable_key = 'fake-ch-1'), 'fake-maintainer');
\i $TMP/v4-reverified.sql
select pg_temp.settle();
select pg_temp.assert_eq('v4: repeated verification records the new verifier', (select verified_by from public.chapters where stable_key = 'fake-ch-1'), 'fake-reviewer');
select pg_temp.assert_eq('v4: and the new date', (select verified_at::date::text from public.chapters where stable_key = 'fake-ch-1'), '2000-02-01');
select pg_temp.assert_eq('v4: other chapters keep their original verifier', (select count(*)::text from public.chapters where verified_by = 'fake-maintainer' and stable_key::text <> 'fake-ch-1' and status = 'published'), '4');
-- restore chapter 1 to the original verification for the later scenarios
\i $TMP/v1.sql
select pg_temp.settle();
select pg_temp.assert_eq('v1 again: its explicit verification values apply (that is what repeating verification means)', (select verified_by from public.chapters where stable_key = 'fake-ch-1'), 'fake-maintainer');

-- ---------------------------------------------------------------- an import that fails late is atomic
create temp table before_late as select stable_key::text sk, title, status from public.chapters;
select pg_temp.assert_eq('late failure: reports the database refusing', (select left(pg_temp.try_sql(:'late_failure'), 5)), '23514');
select pg_temp.assert_eq('late failure: the earlier rename was rolled back', (select title from public.chapters where stable_key = 'fake-ch-1'), 'FAKE Chapter 1');
select pg_temp.assert_eq('late failure: no chapter changed at all',
  (select count(*)::text from public.chapters c join before_late b on b.sk = c.stable_key::text and b.title = c.title and b.status = c.status), (select count(*)::text from before_late));
select pg_temp.assert_eq('late failure: no audit batch was written for it', (select count(*)::text from public.curriculum_import_batches where bundle_version = '1' and content_sha256 <> (select content_sha256 from public.curriculum_import_batches order by applied_at limit 1)), '0');

-- ---------------------------------------------------------------- retire-all protection (S11)
create temp table before_retire as select stable_key::text sk, status from public.chapters;
create temp table denied_result as select pg_temp.try_sql(:'retire_all_denied') as r;
select pg_temp.assert_eq('retire-all: refused by default', (select left(r, 5) from denied_result), '23514');
select pg_temp.assert_eq('retire-all: message names the scope', (select (r like '%scope "chapters"%')::text from denied_result), 'true');
select pg_temp.assert_eq('retire-all: message names the count', (select (r like '%retire ALL 5 active%')::text from denied_result), 'true');
select pg_temp.assert_eq('retire-all: message names the way to confirm', (select (r like '%--allow-retire-all%')::text from denied_result), 'true');
select pg_temp.assert_eq('retire-all: refusal changed nothing (statuses)', (select count(*)::text from public.chapters c join before_retire b on b.sk = c.stable_key::text and b.status = c.status), (select count(*)::text from before_retire));
select pg_temp.assert_eq('retire-all: refusal added no chapters', (select count(*)::text from public.chapters where stable_key::text like 'fake-new-ch-%'), '0');

select pg_temp.assert_eq('retire-all: accepted with the explicit override', pg_temp.try_sql(:'retire_all_allowed'), 'OK');
select pg_temp.settle();
select pg_temp.assert_eq('retire-all: all five old chapters retired, not deleted', (select count(*)::text from public.chapters where stable_key::text in ('fake-ch-1','fake-ch-2','fake-ch-3','fake-ch-4','fake-ch-5') and status = 'retired'), '5');
select pg_temp.assert_eq('retire-all: replacements published', (select count(*)::text from public.chapters where stable_key::text like 'fake-new-ch-%' and status = 'published'), '5');
select pg_temp.assert_eq('retire-all: replacements took the retired chapters'' positions', (select count(*)::text from public.chapters n join public.chapters o on o.subject_id = n.subject_id and o.sequence_no = n.sequence_no and o.status = 'retired' and n.status = 'published' where n.stable_key::text like 'fake-new-ch-%'), '5');
select pg_temp.assert_eq('retire-all: student reference still resolves to the retired chapter', (select count(*)::text from public.standin_progress p join public.chapters c on c.id = p.chapter_id and c.status = 'retired'), '1');
select pg_temp.assert_eq('retire-all: no chapter was ever deleted', (select count(*)::text from public.chapters), '11');
select pg_temp.assert_eq('retire-all: the CSV stays published', (select status from public.course_syllabus_versions), 'published');

-- ---------------------------------------------------------------- verified_by is preserved by ordinary imports
select pg_temp.assert_eq('verified_by is recorded', (select verified_by from public.chapters where stable_key = 'fake-ch-2'), 'fake-maintainer');
select 'importer: idempotency, update, retire, rollback, never-downgrade, atomicity, retire-all guard and reference protection all OK';
rollback;
SQL

echo "== importer integration test (fake fixture, rolled back) =="
"${PSQL[@]}" -t -A -f "$TMP/run.sql" | grep -v '^$'

# Incomplete bundles must abort inside the database, leaving nothing behind.
for bad in bad-no-chapter bad-enable-draft-attempt; do
  if "${PSQL[@]}" -c "begin;" -f "$TMP/$bad.sql" >/dev/null 2>"$TMP/$bad.err"; then
    echo "FAIL: $bad was accepted by the database"; exit 1
  fi
  if ! grep -qE "not ready|not published|cannot enable" "$TMP/$bad.err"; then
    echo "FAIL: $bad failed for the wrong reason:"; cat "$TMP/$bad.err"; exit 1
  fi
  echo "importer: $bad correctly refused by the database ($(grep -oE 'ERROR:[^(]*' "$TMP/$bad.err" | head -1))"
done

left="$("${PSQL[@]}" -t -A -c "select (select count(*) from public.courses) + (select count(*) from public.chapters) + (select count(*) from public.curriculum_import_batches) + (select count(*) from public.source_references)")"
if [ "$left" != "0" ]; then echo "FAIL: $left row(s) persisted after the test"; exit 1; fi
echo "importer: nothing persisted (the student-facing dataset is still empty)"
echo "ALL IMPORTER DATABASE CHECKS PASSED"
