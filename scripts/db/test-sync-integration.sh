#!/usr/bin/env bash
# M7 + M8 integration test against the LOCAL Supabase stack (real PostgREST, RLS and the enrolment functions).
#
#   bash scripts/db/test-sync-integration.sh
#
# Needs the local stack (supabase start) and psql. Refuses anything but this machine. It installs the clearly-FAKE curriculum fixture
# (the real curriculum is, and must stay, a draft), removes it afterwards, and refuses to start unless every shared curriculum table is empty.
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
  *) echo "REFUSED: the sync integration test only runs against a local stack (SUPABASE_URL=${SUPABASE_URL:-unset})"; exit 2 ;;
esac
export PGHOST="${PGHOST:-127.0.0.1}"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "REFUSED: local database only (PGHOST=$PGHOST)"; exit 2 ;; esac
[ -n "${SUPABASE_ANON_KEY:-}" ] || { echo "could not read the local anon key (is the stack running?)"; exit 2; }

export SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_INTEGRATION=1
npx vitest run src/test/integration/sync.integration.test.ts
echo "ALL SYNC INTEGRATION CHECKS PASSED"
