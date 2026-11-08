#!/usr/bin/env bash
# Real two-browser-page sign-out test against the LOCAL Supabase stack (see scripts/db/two-tab-test.ts).
#
#   bash scripts/db/test-two-tab.sh             the scenario must pass
#   bash scripts/db/test-two-tab.sh --mutate    also prove the test FAILS when the unbinding guard, or the sign-out ordering protection, is removed
set -euo pipefail
cd "$(dirname "$0")/../.."

SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  STATUS="$("$SUPABASE_BIN" status -o env 2>/dev/null)"
  SUPABASE_URL="$(printf '%s\n' "$STATUS" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  SUPABASE_ANON_KEY="$(printf '%s\n' "$STATUS" | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
fi
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "REFUSED: local stack only (SUPABASE_URL=${SUPABASE_URL:-unset})"; exit 2 ;;
esac
export PGHOST="${PGHOST:-127.0.0.1}"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "REFUSED: local database only (PGHOST=$PGHOST)"; exit 2 ;; esac
export SUPABASE_URL SUPABASE_ANON_KEY
RUNNER=(node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/db/two-tab-test.ts)

echo "== the real scenario"
"${RUNNER[@]}"

if [ "${1:-}" = "--mutate" ]; then
  for m in ordering guard; do
    echo; echo "== mutation: remove the '$m' protection (the test must now FAIL)"
    if "${RUNNER[@]}" --mutate-run "$m"; then
      echo "NOT DETECTED: the test still passes with the '$m' protection removed"; exit 1
    fi
    echo "DETECTED: the test fails without the '$m' protection"
  done
fi
echo "ALL TWO-TAB CHECKS PASSED"
