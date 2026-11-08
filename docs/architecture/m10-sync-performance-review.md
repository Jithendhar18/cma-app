# M10 review — sync performance and reliability

Second commit on `feature/m9-m10-account-management-sync-performance` (after M9). **Nothing is pushed, merged or deployed. No database change.**

## 1. Outcome

| Workload (local stack, 3 runs each) | Before (M8) | After (M10) |
| --- | --- | --- |
| **Send a 450-record backlog** | 1,124–1,370 ms, **450 requests**, 213 KB | 144–151 ms, **3 requests**, 54 KB |
| Send 200 records, one of them refused by the database | 440–542 ms, **200 requests**, 83 KB; 199 saved, 1 reported | 72–78 ms, **17 requests**, 26 KB; 199 saved, 1 reported |
| Send the same 450 again (a retry whose answers were lost) | 1,908–4,024 ms, **900 requests**, 275 KB; nothing duplicated | 50–84 ms, **15 requests**, 213 KB; nothing duplicated |
| Hydrate 2,500 rows | 54–67 ms, 11 requests, 1,187 KB | 59–66 ms, 11 requests, 1,187 KB (unchanged) |
| Incremental pull, nothing changed | 57–74 ms, 11 requests, **1,183 KB** | 40–52 ms, 11 requests, **294 KB** |
| ID reconciliation (2,500 rows) | 52–72 ms, 11 requests, **1,187 KB** | 38–43 ms, 11 requests, **296 KB** |

These are measurements on a laptop against a local database over loopback, one machine, a handful of runs. **They show the request count and bytes, which are properties of the code; the milliseconds are not a promise about production**, where each request also pays a real network round trip (so fewer requests matters more there, not less). Before-numbers were measured on the unchanged M9 code with the same instrumented test (request counter and response-size counter around every call to the data API); the original 11-run baseline from before M9 agrees with them.

What did **not** improve, honestly: hydration stays at 11 requests and the same bytes (nine tables plus paging; going lower would need a new database function, which I did not add), and updates and deletes still cost one request each (see section 3).

## 2. Baseline before changing anything
Run on `origin/main` + M9 (no sync change) with the benchmark scenarios of M8 (450 operations, 2,500-row hydration) plus two added for this milestone (200 with one refused, and a resent backlog). Request counting was added to the test only (a wrapped `fetch` on the test client), then the same test was run on the new code. Raw numbers: section 1 and `scripts/db/test-sync-integration.sh` (it prints `M8 TIMINGS`).

## 3. Design: safe batched writes, no migration

**Investigation.** Could the existing PostgREST operations be consolidated safely? For **new rows**, yes: one `INSERT … ON CONFLICT DO NOTHING` statement per run of rows, which PostgREST exposes as a bulk `upsert(..., { ignoreDuplicates: true })`. It runs as the signed-in user, so row level security, the ownership checks, the column grants and the quota triggers apply exactly as for a single insert. (The quota trigger is `AFTER INSERT`, so rows skipped as duplicates consume no quota; verified in the SQL.) For **edits and deletes**, no: each is conditional on the `updated_at` the edit was based on, with different values per row, which a bulk statement cannot express without a new database function. Because inserts are the bulk workload (long offline stretches, imports) and edits are a handful at a time, I did **not** add a function or a migration.

**What is batched:** consecutive new rows of one table, up to 200 per request (`BULK_MAX`), parents before children exactly as before (the queue order is unchanged; only adjacent inserts of one table are merged). **What is not:** edits, deletes, and the name/settings/dates, which keep one conditional request each.

**Atomicity, stated plainly.** A bulk request is one statement: it writes **all** of its rows or **none**. So:
- a failure that is not about a particular row (offline, signed out, server busy, permission refusal) is reported for **every** row of the group and **nothing was written**, so a later retry cannot duplicate anything;
- if the statement is refused because of one bad row (a constraint, a unique rule, a per-account limit), the group is **split in half and each half retried**, down to single rows; good rows are saved and only the bad row is reported. A single row goes through the ordinary one-row path, so its outcome is exactly what it was in M8;
- a permission refusal is not bisected (it covers the whole user and enrolment, so splitting could not help): 150 rows aimed at another user's enrolment cost **one** request, not 300;
- rows the database skipped as already present are read back (in groups of 40, to keep the URL short) and compared: identical means done (idempotent retry), different means a conflict carrying the server's copy, exactly as a single insert reports.

I did not claim per-row recovery from the transaction: per-row outcomes come from the splitting, and the tests check each outcome class.

**Per-operation outcomes** (all covered): applied (with the server's id and version), already there and identical (applied), conflict (different content: server wins, with the server's copy), refused for a rule (set aside by the engine, recoverable), refused for a per-account limit (plain message), waiting (a focus record whose planned session is not yet on the server), transient failure (retry with backoff), offline, signed out.

## 4. Ordering, concurrency and sign-out (unchanged guarantees, checked)
- Parents before children, children before parents on delete: the queue order is untouched; bulk groups never reorder across tables or past an edit.
- Multi-tab locking, the storage lease, and the outbox re-reading before every change are untouched. New tests: a change another tab queues **while a batch is in flight** is not overwritten by the batch's clean-up and is sent; two tabs sharing one queue send a 250-record backlog once. A **negative control** (removing the outbox's re-read) makes both the M8 two-tab test and the new in-flight test fail.
- Stale pulls never overwrite a pending change (M8 behaviour, unchanged and still tested).
- **Two M8 paths that could enqueue local data if the stores unbound while a request was in flight were found and closed** (found while checking this milestone's safety list):
  1. a *conflict result arriving after unbinding* re-read the store (by then the local sample data) and queued it (and its absence as deletions of the account's records);
  2. a *hydration returning after unbinding* did the same.
  Both now do nothing once the engine is no longer bound to this account. Each has a regression test, and each fails when its guard is removed (checked by mutation). The real two-browser-page test from M8 still passes with both of its mutations detected.

## 5. Lighter pulls (supported by the measurements)
- **Incremental pull:** when the caller knows the versions it already holds, the first pass reads only `id`, key and `updated_at`; only rows that are new or at a different version are then read in full. "Changed" is still decided by the row's own version, never by an assumption. Result: **−75% bytes** for an unchanged pull (1,183 KB → 294 KB). A changed row keeps its link to an unchanged planned session (tested).
- **ID reconciliation** reads only ids and versions: **−75% bytes**.
- **Bulk insert replies** return only `id`, key and version: 213 KB → 54 KB for 450 records.
- Not changed: hydration (it needs every row), the `gte` cursor (kept; rows that tie on the cursor are re-listed but not re-downloaded in full), and the 30-minute reconciliation cadence. I did not replace any correctness check with a timestamp assumption.

## 6. Diagnostics
`SyncEngine.getDiagnostics()` returns counts and times only: queued, set aside, conflicts logged, flushes, batches, operations sent, applied, conflicts resolved, refused, retried, requests this session, the last batch (operations, requests, milliseconds) and the last successful sync. It is shown in the sync panel under "Details for troubleshooting". It contains no content, names, ids or tokens (a test asserts that).

## 7. Files
`src/lib/sync/supabasePersonal.ts` (batched inserts, bisection, read-back, light pulls, request counter), `engine.ts` (diagnostics, known-version pull, two in-flight guards), `types.ts` (diagnostics type, repository signature), `src/features/sync/{SyncPanel,SyncProvider,syncContext}.ts(x)` (diagnostics), tests: `src/lib/sync/batch.test.ts` (new, 36), updated `supabasePersonal.test.ts` and `engine.test.ts` (their expectations name the new request kinds; one now uses the atomic row-rejection hook of the fake), `fakeBackend.ts` (call log records the column list), `sync.integration.test.ts` (request and byte counters, the new benchmark scenarios, 17b and 17c, assertions on request counts). **No SQL file changed.**

## 8. Security and RLS
- Same authenticated, user-scoped access as before; no privileged credential; no new SQL function, grant or policy (so there is no new privilege model to review).
- Ownership comes from the scope, never from the operation (tested for bulk rows). A batch aimed at another user's enrolment is refused by RLS on the real database in one request and writes nothing (scenario 17c).
- Append-only idempotency is still `(user_id, client_id)` (and `(enrollment_id, chapter_id)` for progress); conditional `updated_at` writes, server-wins conflicts, the persistent conflict log and the set-aside list are unchanged.

## 9. Tests and results
| Suite | Result |
| --- | --- |
| Vitest, whole project | 916 passed, 50 skipped (opt-in real-stack suites: auth 19, sync/portability 31) |
| New batch tests | 36: chunk boundaries (1, 2, 199, 200, 201, 400, 401, 450), order of results, scope stamping, mixed backlog, edits/deletes kept separate, duplicates, conflicts, atomic transient failure and retry, offline, expired session, one and several refused rows, per-account limit mid-batch, permission refusal, clash with another record, waiting for a planned session, engine flow, diagnostics, in-flight concurrency, two tabs, unbinding in flight, light pulls, request counting |
| Enrolment + sync + portability integration (real local stack) | 31 passed (adds 17b, 17c and the request-count assertions) |
| Auth integration | 19 passed |
| Two real browser pages | passes; both mutations detected |
| pgTAP | 789 passed |
| Importer / real bundle / staged publication / committed behaviour | all pass |
| Curriculum importer tests | 121 passed |
| Typecheck, ESLint, build | 0 errors, 0 problems, succeeds |
| Secret guard | repository and `dist/` clean |
| Schema lint | no errors |

## 10. Known limitations
- Edits and deletes still cost one request each. A database function could batch them with per-row version checks; that is a migration with its own privilege review, and the measured workloads do not need it. Deferred.
- Hydration is 11 requests for nine tables plus paging; lower needs a new function too.
- Rows that tie on the incremental-pull cursor (a big bulk insert shares one timestamp) are re-listed (ids only) on each pull. Cheap now; a per-table cursor could remove it but would add edge cases for late commits, so I left the cursor alone.
- A bulk insert that fails for a per-row reason costs about 2 × log2(group size) requests to isolate it (17 for 200 rows with one bad), versus 200 before.
- A local id that already exists under a *different* enrolment of the same user shows up as a conflict with no server copy (the sync engine reports it as "deleted elsewhere"); the import wizard reports it correctly as a clash. Pre-existing M8 wording; record ids are UUID-based so it should not occur in practice.

## 11. Deferred
Server-side batched edits/deletes and hydration in fewer requests (would need a reviewed migration); a per-table pull cursor; surfacing diagnostics anywhere beyond the sync panel.

## 12. Manual action
None.
