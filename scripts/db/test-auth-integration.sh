#!/usr/bin/env bash
# Auth integration test against the LOCAL Supabase stack (real GoTrue, trigger, PostgREST and RLS).
#
#   bash scripts/db/test-auth-integration.sh
#
# Needs: the local stack running (supabase start), psql, and the Supabase CLI. It reads the local API URL and the public anon key
# from `supabase status`, never from a hosted project, and refuses to run against anything but this machine. It creates throwaway
# users on @example.test and deletes them afterwards.
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
  *) echo "REFUSED: the auth integration test only runs against a local stack (SUPABASE_URL=${SUPABASE_URL:-unset})"; exit 2 ;;
esac
[ -n "${SUPABASE_ANON_KEY:-}" ] || { echo "could not read the local anon key (is the stack running?)"; exit 2; }

export SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_INTEGRATION=1
npx vitest run src/test/integration/auth.integration.test.ts
echo "ALL AUTH INTEGRATION CHECKS PASSED"
