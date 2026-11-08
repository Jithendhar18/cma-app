#!/usr/bin/env bash
# Tests that need REAL COMMITS, against the LOCAL Supabase stack:
#   * per-user row quotas under concurrency (decision U1): racing sessions for the last slot,
#   * enrolment and account functions run as an authenticated user through a real commit. Deferred constraint
#     triggers only run at COMMIT, so a pgTAP transaction (which rolls back) cannot see privilege bugs in them.
#
# A single transaction cannot race two sessions for the last slot, so this runs real parallel psql sessions that
# COMMIT, which needs the fake curriculum to be committed too. It therefore:
#   * refuses to run against anything but 127.0.0.1/localhost,
#   * refuses to run unless the database holds no curriculum yet (so it can never pollute real data),
#   * leaves the local database containing the FAKE fixture. RESET IT AFTERWARDS:  supabase db reset
#     (set RESET_CMD to have this script do it, for example RESET_CMD="npx supabase@3.0.0 db reset").
set -euo pipefail
cd "$(dirname "$0")/../.."

export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGDATABASE="${PGDATABASE:-postgres}"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "REFUSED: local databases only (PGHOST=$PGHOST)"; exit 2 ;; esac
PSQL=(psql -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose)
sql() { "${PSQL[@]}" -c "$1"; }

if [ "$(sql 'select count(*) from public.courses')" != "0" ]; then
  echo "REFUSED: the database already contains curriculum. Run 'supabase db reset' first."; exit 2
fi

fail() { echo "FAIL: $*"; exit 1; }
UA=11111111-1111-4111-8111-111111111111
EA=aaaaaaaa-0000-4000-8000-0000000000e1

echo "== setting up the fake fixture (committed) =="
sql "select tests.build_personal_fixture()" >/dev/null 2>&1 || fail "the test helpers are not installed: run 'supabase test db' once first"
CSV=$(sql "select id from public.course_syllabus_versions where stable_key = 'fake-csv-1'")
CH=$(sql "select id from public.chapters where stable_key = 'fake-ch-1'")

# one authenticated insert, exactly as the API would run it; prints OK or the SQLSTATE
insert_as_user() {
  local tag="$1"
  "${PSQL[@]}" -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$UA\"}', true);
    insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
    values ('$tag', '$UA', '$EA', '$CSV', '$CH', '2090-05-01', 10, 'pomodoro'); commit;" >/dev/null 2>"$TMPDIR_Q/$tag.err" && echo OK || { sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' "$TMPDIR_Q/$tag.err" | head -1; }
}
export -f insert_as_user
export CSV CH UA EA PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
TMPDIR_Q="$(mktemp -d)"; export TMPDIR_Q
trap 'rm -rf "$TMPDIR_Q"' EXIT
export PSQL_BIN=psql
PSQL_DECL="$(declare -p PSQL)"; export PSQL_DECL

used() { sql "select coalesce((select used from public.user_quota_usage where user_id = '$UA' and resource = '$1'), 0)"; }
rows() { sql "select count(*) from public.study_sessions where user_id = '$UA'"; }
audit() { sql "select count(*) from public.quota_audit()"; }

run_parallel() {  # run_parallel <prefix> <attempts> <workers>  -> prints outcomes, one per line
  seq 1 "$2" | xargs -P "$3" -I{} bash -c 'eval "$PSQL_DECL"; insert_as_user "'"$1"'-{}"'
}

[ "$(audit)" = "0" ] || fail "counters are not consistent before the test"
BASE=$(rows)

echo "== 1. many workers race past a limit of $((BASE + 40)) =="
sql "update public.quota_limits set max_rows = $((BASE + 40)) where resource = 'study_sessions'"
OUT=$(run_parallel race 120 12)
OK=$(echo "$OUT" | grep -c '^OK$' || true); DENIED=$(echo "$OUT" | grep -c '^P0429$' || true); OTHER=$(echo "$OUT" | grep -vcE '^(OK|P0429)$' || true)
echo "   accepted=$OK refused=$DENIED other=$OTHER"
if [ "$OTHER" != "0" ]; then echo "   outcomes:"; echo "$OUT" | sort | uniq -c | sed 's/^/     /'; echo "   sample error:"; head -c 400 "$TMPDIR_Q"/race-*.err | head -5; fi
[ "$OK" = "40" ] || fail "exactly 40 inserts should have succeeded, got $OK"
[ "$DENIED" = "80" ] || fail "exactly 80 should have been refused with P0429, got $DENIED"
[ "$OTHER" = "0" ] || fail "unexpected errors (deadlock or worse): $(echo "$OUT" | grep -vE '^(OK|P0429)$' | sort | uniq -c)"
[ "$(rows)" = "$((BASE + 40))" ] || fail "row count $(rows) is not $((BASE + 40))"
[ "$(used study_sessions)" = "$((BASE + 40))" ] || fail "counter $(used study_sessions) does not match the rows"
[ "$(audit)" = "0" ] || fail "counters drifted from reality after the race"

echo "== 2. the LAST slot: 16 workers, one slot, exactly one winner =="
sql "delete from public.study_sessions where id = (select id from public.study_sessions where user_id = '$UA' and client_id like 'race-%' limit 1)"
[ "$(used study_sessions)" = "$((BASE + 39))" ] || fail "decrement did not apply"
OUT=$(run_parallel last 16 16)
OK=$(echo "$OUT" | grep -c '^OK$' || true); DENIED=$(echo "$OUT" | grep -c '^P0429$' || true)
echo "   accepted=$OK refused=$DENIED"
[ "$OK" = "1" ] || fail "exactly one worker may take the last slot, got $OK"
[ "$DENIED" = "15" ] || fail "the other 15 must be refused, got $DENIED"
[ "$(used study_sessions)" = "$((BASE + 40))" ] || fail "counter is not exactly at the limit"
[ "$(audit)" = "0" ] || fail "counters drifted after the last-slot race"

echo "== 3. concurrent inserts across TWO tables share the aggregate limit with no deadlock =="
sql "update public.quota_limits set max_rows = 100000 where resource = 'study_sessions'"
TOTAL_NOW=$(used total)
sql "update public.quota_limits set max_rows = $((TOTAL_NOW + 30)) where resource = 'total'"
insert_practice() {
  "${PSQL[@]}" -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$UA\"}', true);
    insert into public.practice_records (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, questions, correct)
    values ('$1', '$UA', '$EA', '$CSV', '$CH', '2090-05-01', 5, 5); commit;" >/dev/null 2>"$TMPDIR_Q/$1.err" && echo OK || { sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' "$TMPDIR_Q/$1.err" | head -1; }
}
export -f insert_practice
OUT=$( { seq 1 40 | xargs -P 10 -I{} bash -c 'eval "$PSQL_DECL"; insert_as_user "mix-s-{}"' & seq 1 40 | xargs -P 10 -I{} bash -c 'eval "$PSQL_DECL"; insert_practice "mix-p-{}"' & wait; } )
OK=$(echo "$OUT" | grep -c '^OK$' || true); OTHER=$(echo "$OUT" | grep -vcE '^(OK|P0429)$' || true)
echo "   accepted=$OK other=$OTHER"
[ "$OK" = "30" ] || fail "exactly 30 inserts fit under the aggregate limit, got $OK"
[ "$OTHER" = "0" ] || fail "unexpected errors (a deadlock would show here): $(echo "$OUT" | grep -vE '^(OK|P0429)$' | sort | uniq -c)"
[ "$(used total)" = "$((TOTAL_NOW + 30))" ] || fail "total counter is not exactly at its limit"
[ "$(audit)" = "0" ] || fail "counters drifted after the two-table race"

echo "== 4. a bulk insert that crosses the boundary changes nothing =="
sql "update public.quota_limits set max_rows = $(( $(used total) + 5 )) where resource = 'total'"
BEFORE_ROWS=$(rows); BEFORE_TOTAL=$(used total)
if "${PSQL[@]}" -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$UA\"}', true);
  insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  select 'bulk-' || g, '$UA', '$EA', '$CSV', '$CH', '2090-05-01', 10, 'pomodoro' from generate_series(1, 50) g; commit;" >/dev/null 2>&1; then fail "the bulk insert should have been refused"; fi
[ "$(rows)" = "$BEFORE_ROWS" ] || fail "the failed bulk insert left rows behind"
[ "$(used total)" = "$BEFORE_TOTAL" ] || fail "the failed bulk insert moved the counter"
[ "$(audit)" = "0" ] || fail "counters drifted after the failed bulk insert"

echo "== 5. enrolment functions work through a REAL COMMIT as an authenticated user =="
FLOW=30000000-0000-4000-8000-000000000001
G1=$(sql "select id from public.subject_groups where stable_key = 'fake-group-1'")
G2=$(sql "select id from public.subject_groups where stable_key = 'fake-group-2'")
ATT_A=$(sql "select id from public.exam_attempts where stable_key = 'fake-attempt-a'")
ATT_B=$(sql "select id from public.exam_attempts where stable_key = 'fake-attempt-b'")
sql "insert into auth.users (id, email) values ('$FLOW', 'flow@example.invalid')"
NOWE=$(sql "select floor(extract(epoch from clock_timestamp()))")
flow() {  # flow "<sql>"  -> runs it as the flow user in its own COMMITTED transaction; prints the last output line
  "${PSQL[@]}" -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$FLOW\",\"amr\":[{\"method\":\"password\",\"timestamp\":$NOWE}]}', true); $1; commit;" | tail -1
}
E1=$(flow "select public.create_enrollment('$CSV', '$ATT_A', array['$G1','$G2']::uuid[])") || fail "create_enrollment failed at commit"
[ -n "$E1" ] || fail "create_enrollment returned nothing"
[ "$(sql "select count(*) from public.enrollment_groups where enrollment_id = '$E1'")" = "2" ] || fail "groups were not stored"
flow "select public.set_enrollment_groups('$E1', array['$G2']::uuid[])" >/dev/null || fail "set_enrollment_groups failed at commit"
[ "$(sql "select count(*) from public.enrollment_groups where enrollment_id = '$E1'")" = "1" ] || fail "groups were not replaced"
flow "select public.change_enrollment_attempt('$E1', '$ATT_B')" >/dev/null || fail "change_enrollment_attempt failed at commit"
flow "select public.archive_enrollment('$E1')" >/dev/null || fail "archive_enrollment failed at commit"
E2=$(flow "select public.create_enrollment('$CSV', '$ATT_A', array['$G1']::uuid[])") || fail "second create_enrollment failed at commit"
flow "select public.activate_enrollment('$E1')" >/dev/null || fail "activate_enrollment failed at commit"
[ "$(sql "select count(*) from public.student_enrollments where user_id = '$FLOW' and status = 'active'")" = "1" ] || fail "there should be exactly one active enrolment"
[ "$(sql "select status from public.student_enrollments where id = '$E2'")" = "archived" ] || fail "the other enrolment should have been archived"
# the rule that an active enrolment needs a group must still hold at commit
if "${PSQL[@]}" -c "begin; set local role postgres; delete from public.enrollment_groups where enrollment_id = '$E1'; commit;" >/dev/null 2>&1; then fail "removing the last group must fail at commit"; fi
[ "$(sql "select count(*) from public.enrollment_groups where enrollment_id = '$E1'")" = "1" ] || fail "the group was removed despite the failed commit"
# deleting the account with the committed enrolments, groups and counters
flow "select public.delete_my_account()" >/dev/null || fail "delete_my_account failed at commit"
[ "$(sql "select count(*) from auth.users where id = '$FLOW'")" = "0" ] || fail "the account survived deletion"
[ "$(sql "select count(*) from public.student_enrollments where user_id = '$FLOW'")" = "0" ] || fail "enrolments survived deletion"
[ "$(audit)" = "0" ] || fail "counters inconsistent after the enrolment flows"
echo "   create, change groups, change attempt, archive, create again, activate, and delete all committed correctly"

echo "== 6. account deletion under load leaves nothing behind =="
sql "update public.quota_limits set max_rows = 50000 where resource = 'total'"
NOW=$(sql "select floor(extract(epoch from clock_timestamp()))")
"${PSQL[@]}" -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$UA\",\"amr\":[{\"method\":\"password\",\"timestamp\":$NOW}]}', true); select public.delete_my_account(); commit;" >/dev/null
[ "$(sql "select count(*) from public.user_quota_usage where user_id = '$UA'")" = "0" ] || fail "counters survived account deletion"
[ "$(sql "select count(*) from public.study_sessions where user_id = '$UA'")" = "0" ] || fail "rows survived account deletion"
[ "$(audit)" = "0" ] || fail "counters inconsistent after account deletion"

echo "ALL QUOTA CONCURRENCY CHECKS PASSED"
echo "NOTE: the local database now contains the fake fixture. Reset it:  supabase db reset"
if [ -n "${RESET_CMD:-}" ]; then echo "resetting: $RESET_CMD"; eval "$RESET_CMD" >/dev/null 2>&1 && echo "database reset"; fi
