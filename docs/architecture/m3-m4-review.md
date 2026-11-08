# M4 + M3 Review Package

Status: **final decisions applied (see section 7). Committed locally as two commits (M4, then M3); not pushed, not deployed.** M1 and M2 are `88e2936`. Nothing here creates a hosted project, connects the frontend, adds authentication UI, or introduces curriculum data.

Scope: M4 (CI protections) and M3 (personal student tables with strict RLS). No change under `src/`; the existing UI and local mode
are untouched.

## 1. What was built

| Area | Files |
| --- | --- |
| M4: database CI | `.github/workflows/database.yml` (curriculum job and local-Supabase database job, no path filter, no secrets) |
| M4: secret guard (S4) | `scripts/ci/guard-secrets.ts`, `scripts/ci/guard-secrets-cli.ts`, `scripts/ci/guard-secrets.test.ts`, `npm run guard:secrets` |
| M4: app CI | `.github/workflows/ci.yml` now runs the guard before type checking and on the built bundle; actions pinned to commit SHAs |
| M4: pin maintenance | `.github/dependabot.yml` (weekly, GitHub Actions only) |
| M3: migrations | `supabase/migrations/20261108000400_personal_data.sql`, `…000500_personal_data_rls.sql`, `…000600_personal_quotas.sql` |
| M3: tests | `supabase/tests/database/000_personal_helpers`, `010`–`019` (new), plus `001`, `002`, `007`, `013`, `099` updated |

## 2. M4: CI protections

### 2.1 Secret guard (decision S4)

`npm run guard:secrets` scans every tracked or untracked-but-not-ignored file, and, with `--dist dist`, the production bundle. It fails
(exit 1, reporting file, line and rule, **never the value**) on:

| Rule | Where it applies |
| --- | --- |
| a JWT whose `role` claim is `service_role` or `supabase_admin` | every file |
| an `sb_secret_…` key, or a private-key block | every file |
| a database URL carrying a password for a non-local host | every file |
| the words service role / `service_role` / `serviceRoleKey` | browser-reachable files only: `src/`, `public/`, `index.html`, `vercel.json`, `vite.config.ts`, `.env*`, and the built `dist/` |
| a `VITE_` variable named like a secret (`SERVICE`, `SECRET`, `PRIVATE`, `PASSWORD`, `TOKEN`, `ADMIN`, `DATABASE_URL`) | every file |

Anon and authenticated JWTs are allowed (they are public by design). Docs, SQL and config may discuss the service role freely
because they cannot reach the browser. The guard has **no exemption for its own files**: they were reworded and their test strings
are built at runtime, so a credential hidden in them would still be caught.

Verified by: 40 unit tests; a clean run on the repository and on a fresh build (208 files); and three planted violations (a
service-role JWT in `src/`, a secret-named `VITE_` variable, and the service role inside a built asset), each of which failed the
guard without printing the value.

### 2.2 `database.yml`

| Item | Detail |
| --- | --- |
| Triggers | every pull request into `main`, pushes to `main`, and manual runs. **No path filter**, so the checks always exist and can be required in branch protection |
| Permissions | `contents: read`; checkout does not persist credentials; no secrets are referenced (checked) |
| `curriculum` job (10 min) | importer unit tests; validates the fake fixture; proves the CLI **refuses** to emit SQL for a fake bundle; validates and generates SQL for any real bundle that exists |
| `database` job (20 min) | confirms no hosted credential variable is set; starts a throwaway local Supabase stack; rebuilds from migrations; runs pgTAP; lints; runs the importer integration test; runs `scripts/db/test-committed.sh` (real commits: quota races and enrolment flows); always stops the stack |
| Supply chain | all three third-party actions pinned to commit SHAs; each SHA was verified against GitHub to be a real commit that the named tag points at; Dependabot opens weekly update PRs |

**Honest limits.** The workflow YAML was parsed and cross-checked against the real `package.json` scripts, and every command in it was
run locally, but **it has not run on GitHub**. Real-runner behaviour (Docker image pull time, `psql` presence, CLI action behaviour)
will only be confirmed by the first run. `supabase/setup-cli` is now at major v3; my initial recollection (v1) was wrong, which is why
the pins were verified rather than typed from memory.

### 2.3 Settings you need to apply on GitHub (not something I can do from here)

- **Branch protection on `main` (U10):** require the `CI` workflow and both `Database` jobs. They always run for pull requests, so a
  required check can never stay pending.
- **Fork pull requests** receive no secrets by default; these workflows need none.
- **Actions minutes:** the database job pulls Docker images, so it is the most expensive job (verify the current free allowance for a
  private repository).

## 3. M3: personal data

### 3.1 Isolation model: two independent layers

1. **Row level security:** every personal table is `ENABLE ROW LEVEL SECURITY`; a user reaches only rows where `user_id` is themselves.
2. **Composite foreign keys:** every personal row carries `user_id` and `csv_id`, and references `(enrollment_id, user_id, csv_id)` and
   `(chapter_id, csv_id)`. So even with RLS bypassed, a row cannot point at another user's enrolment or at a chapter from another
   syllabus. This is tested by running the attacks **as the owner role**, which ignores RLS.

### 3.2 Tables (11), views (3), functions (7)

| Table | Purpose | Notes |
| --- | --- | --- |
| `profiles` | one per auth user | created by trigger; id = `auth.users.id`; display name, avatar (image data URL only, ≤ 200 KB), time zone |
| `user_settings` | study preferences | defaults equal the app's current defaults; value checks mirror the UI validation |
| `student_enrollments` | the anchor for all progress | only a supported combination can exist (FK to availability); one active per user (partial unique index); `exam_date_override`, `final_revision_date` |
| `enrollment_groups` | which groups the student prepares for | "Both" is two rows; an active enrolment must always have at least one (checked at commit) |
| `chapter_progress` | status, confidence, notes, `completed_on` | unique per enrolment and chapter; hours, questions and last-studied are **not stored** |
| `planner_sessions` | planned blocks | `missed` is derived, so it cannot be stored |
| `study_sessions` | the single stored source of study time | one row per calendar day; `local_date` is authoritative and never re-derived; `UNIQUE (user_id, client_id)` |
| `revisions` | 1, 2, 3, or 4 (= final) | not both completed and cancelled; one pending per chapter; one live row per number; no client delete |
| `practice_records` | questions and correct | `0 ≤ correct ≤ questions` |
| `mock_tests` | per-paper scores | `0 ≤ score ≤ max`, `max > 0` |
| `local_import_runs` | one row per imported backup | unique on the file hash per user |

| View | Replaces |
| --- | --- |
| `chapter_stats` | the stored chapter hours, questions, correct and last-studied |
| `daily_study_minutes` | the derived study log |
| `enrollment_options` | the data behind the course / syllabus / attempt / group dropdowns (only verified, enabled, ready combinations) |

All three are `security_invoker`, so the caller's RLS applies.

| Function | What it validates |
| --- | --- |
| `create_enrollment(csv, attempt, groups[], replace_active)` | caller signed in; combination enabled, published and ready; groups distinct, non-empty and in that syllabus; refuses a second active enrolment unless `replace_active`, in which case the old one is archived, not deleted |
| `change_enrollment_attempt(enrollment, attempt, clear_dates)` | ownership; only the active enrolment; the new attempt must be enabled for the **same** course and syllabus; progress untouched |
| `set_enrollment_groups(enrollment, groups[])` | ownership; groups in the enrolment's syllabus; at least one; removing a group never touches progress |
| `archive_enrollment`, `activate_enrollment` | ownership; activation archives the current one in the same transaction, so there is always exactly one active |
| `delete_my_account()` | deletes only `auth.uid()`; requires a **password sign-in within the last 5 minutes** (section 3.5); the cascade removes every personal row and nothing shared |

Every `SECURITY DEFINER` function pins `search_path` to empty (asserted for all functions), reads the user from `auth.uid()` (never a
parameter), and is executable only by `authenticated` (and not by `anon`).

### 3.3 RLS policies and grants (actual)

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `profiles` | own | none (trigger) | own; columns `display_name`, `avatar_data_url`, `time_zone`, `onboarding_completed_at` only | none (account deletion) |
| `user_settings` | own | none (trigger) | own; the nine setting columns only | none |
| `student_enrollments` | own | none (function) | own; only `exam_date_override`, `final_revision_date` | none |
| `enrollment_groups` | own | none (function) | none | none |
| `chapter_progress`, `planner_sessions`, `study_sessions`, `practice_records`, `mock_tests` | own | own | own | own |
| `revisions` | own | own | own | **none** (history is kept) |
| `local_import_runs` | own | own | none | none |

`own` means `user_id = (select auth.uid())`, with a matching `WITH CHECK` on writes. The three views are `SELECT` to `authenticated`.
`anon` has nothing. No policy reads `user_metadata`. A BEFORE UPDATE trigger makes the owner, enrolment, syllabus, chapter and
`client_id` columns immutable.

### 3.4 What a client can no longer do (all tested)

Insert or delete a profile; edit its own id; insert an enrolment, a group, or change an enrolment's status, attempt or syllabus
directly; delete revision history; move a record to another user, enrolment or chapter; credit another user's planned session; attach a
chapter or paper from another syllabus; or read, change or delete anything that belongs to someone else.

### 3.5 Per-user quotas (U1)

Private tables `quota_limits` and `user_quota_usage` have RLS on, no policy and no grant, so the client API cannot read or change them.
AFTER INSERT / AFTER DELETE row triggers on the eight client-writable tables with unbounded row counts (`study_sessions`,
`practice_records`, `planner_sessions`, `revisions`, `chapter_progress`, `mock_tests`, `local_import_runs`, `student_enrollments`)
keep the counters in the same transaction, so a rollback undoes them. Each increment is one atomic
`INSERT … ON CONFLICT DO UPDATE … WHERE used < limit` (never count-then-insert); the aggregate ("total") counter is locked first and
then the table counter, so concurrent writers cannot deadlock. AFTER triggers mean an `ON CONFLICT DO NOTHING` retry consumes nothing.
Breaching a limit raises SQLSTATE `P0429` with hint `QUOTA_EXCEEDED`. Account deletion cascades the counters away; deleting rows
releases quota. `profiles`, `user_settings` and `enrollment_groups` are naturally bounded and exempt. `get_my_quota()` lets a user see
their own usage.

| Resource | Limit | Rationale |
| --- | --- | --- |
| total | 50,000 | about 25 MB per account at the ceiling; far above a heavy user |
| study_sessions | 20,000 | one row per day, so decades of use |
| practice_records | 10,000 | |
| planner_sessions | 10,000 | |
| revisions | 8,000 | 4 per chapter |
| chapter_progress | 4,000 | |
| mock_tests | 1,000 | |
| local_import_runs | 100 | |
| student_enrollments | 30 | |

Limits live in a table so a maintainer can change them without a migration.

### 3.6 Account deletion (U2, U3) and date bounds (U5)

Deletion is immediate and irreversible (no grace period). `delete_my_account()` reads the trusted JWT `amr` claim and requires an entry
with `method = 'password'` whose timestamp is within 300 seconds (60 s clock-skew allowance for the future). A stale session, a missing
claim, a one-time-code or OAuth sign-in all fail with SQLSTATE `P0401` (hint `REAUTHENTICATE`). The password is never passed to or
stored by the function. **Client work still needed** (M6/M9): offer a full data export first, require download or acknowledgement, show
the irreversible warning, and ask for the password again.

Ten date columns are bounded to 2000-01-01 … 2100-12-31 (constraints `<table>_<column>_bounds`), which stops junk without rejecting old
imports or far-ahead planning.

## 4. Test results

| Check | Result |
| --- | --- |
| pgTAP (`supabase test db`) | **789 assertions in 20 files, all pass** |
| Committed behaviour (`scripts/db/test-committed.sh`) | passes: 120 racers vs limit 44 give exactly 40 accepted; the last slot has exactly one winner among 16; two-table race with no deadlock; failed bulk insert changes nothing; every enrolment function and `delete_my_account` through real commits; deletion under load; counters consistent |
| Quota / deletion / date mutations (new) | **26 of 26 caught** (definer removed, quota triggers dropped, counter tables granted, limits raised, `quota_take` exposed, window or skew widened, method check loosened, stale/missing/future checks removed, date bounds dropped or widened) |
| M3 mutation testing | **44 distinct deliberate breaks of personal-data protections; the final tests catch all 44.** Run in three rounds (52 runs): 29 breaks (27 caught, 2 survived), then 9 (3 caught, 6 survived, 2 of them repeats), then the 14 policy-loosening breaks after the test fix (all caught). Every survivor was a gap in my tests, now closed (section 5). |
| M1/M2 and M3 mutation sweeps re-run on the final schema | **98 distinct runs, all caught, none survived** (23 M1/M2 + 29 + 9 + 14 M3 runs) |
| Importer integration test against the real database | passes |
| Vitest (all) | **303 tests pass** |
| TypeScript (`src` and `scripts`) | 0 errors |
| ESLint | 0 findings |
| Production build | succeeds |
| Secret guard (repository and built bundle) | clean |
| `supabase db lint --level warning` | no schema errors |
| `src/` changed? | **no** |

Key suites: `012_cross_user_isolation` (123 assertions: both users, every table, both layers, the RPCs, the views, anon, a forged admin
claim, and unconditional updates and deletes), `013_enrollment_functions` (58), `014_personal_integrity` (50), `016_account_deletion` (33: A's data is gone from all 11 tables and
`auth.users`, B's data and every curriculum row are unchanged).

## 5. Defects found by the tests during this work (all fixed)

1. **The "active enrolment needs a group" trigger crashed on group deletion.** One function was shared by two tables and read columns
   that exist on only one of them. Split into one function per table over a shared check. Found by the first deletion test.
2. **My tests could not detect a loosened update or delete policy.** Mutation testing showed that loosening, for example, the
   `planner_sessions` update policy went unnoticed. The cause is a PostgreSQL rule: when a statement's `WHERE` clause reads columns,
   the strict `SELECT` policy is applied as well, which hides other users' rows and masks a weak update/delete policy. An
   **unconditional** statement (`delete from t`, `update t set col = constant`) is governed by the update/delete policy alone, and
   my tests only ever used `WHERE user_id = B`. The policies themselves were correct, but a regression would have shipped
   silently. Isolation tests now also run unconditional updates and deletes on every owned table, last in the file because they
   are destructive to A's own rows, and check that B is untouched **and** that A's rows really were affected. Worth remembering when
   writing any future RLS test.
3. **A test of mine could not fail:** the two gate tests lacked the verifier and would have passed even if the source check were
   removed (M2). Tightened.
4. **The "last group removed" trigger was only covered by accident.** Another trigger caught the same case in the test, so dropping
   the group-delete trigger went unnoticed. The test now flushes pending checks first, and the enrolment-side trigger has its own test.
5. **Importer gaps** found by sabotage (M1/M2 follow-up): never-downgrade and the verifier were untested. Closed.
6. **Test-helper hygiene:** the schema linter flagged untyped UUID literals and unused variables in my test helper. Fixed, and CI now lints
   only the `public` schema.

7. **Commit-time privilege bug (critical, found by the committed-behaviour script, not by pgTAP).** The deferred "active enrolment needs a
   group" trigger functions were not `SECURITY DEFINER`. Deferred constraint triggers run at COMMIT as the API role, so a real user's
   `create_enrollment`, `set_enrollment_groups` and `delete_my_account` failed at commit with 42501. pgTAP never saw it because its
   transactions never commit. Fixed (definer), and the test helpers now flush deferred triggers as the API role: with the bug present the
   improved suite fails broadly (57 failures in file 012, 43 in file 013). **Lesson: anything relying on deferred triggers needs a test
   that really commits.**

## 6. Deviations from the approved design

| Design | As built | Reason |
| --- | --- | --- |
| `delete_my_account` "verify" | verified: a definer function can delete from `auth.users` on the local stack | closes the open question locally; still to be re-checked on the hosted project |
| Single `check_active_enrollment_has_group` | three functions (`assert_…`, one per table) | defect 1 |
| `study_sessions` planner link keyed on user | keyed on **user and enrolment** | a focus record must not credit a planned session from another enrolment |
| `local_import_runs` carried `csv_id` | keys `(enrollment_id, user_id)` only | the log needs ownership, not syllabus scope |
| Planner `missed` stored/accepted | not storable; the importer maps it to `upcoming` | `missed` is derived |
| `updated_at` on every personal table | on all except `enrollment_groups`, `local_import_runs` (append-only) | not needed for incremental pull |
| `enrollment_options` columns | adds course order, `effective_from`, year, session, end date | the dropdowns need them |

## 7. Decisions (resolved)

| # | Decision | Outcome |
| --- | --- | --- |
| U1 | Per-user quotas | implemented before commit (section 3.5) |
| U2 | Account deletion | immediate and irreversible, no grace period; client must offer export, warn, and re-ask the password |
| U3 | Re-authentication | enforced in `delete_my_account()` from the JWT (section 3.6), tested fresh and stale |
| U4 | Time zone pattern-only validation | accepted |
| U5 | Date bounds | 2000-01-01 … 2100-12-31 on ten columns |
| U6 | Display name | untrusted text; the UI must escape it (React does) |
| U7 | `auth.users` trigger | kept; **verify hosted permissions and a real hosted signup at the first migration rehearsal** |
| U8 | Hosted auth settings, confirmation, reset, SMTP | deferred to M6 |
| U9 | First CI run | on a feature branch with a draft PR (maintainer pushes; I do not) |
| U10 | Branch protection | maintainer configures: require CI and both Database jobs |
| U11 | Strict secret guard | retained |

## 8. Not done (by design)

M5 (a verified curriculum bundle), M6 and later (client, sign-up UI, onboarding, sync engine, import wizard), a hosted project, any
frontend integration. Nothing is committed, pushed or deployed.

## 9. How to reproduce

```bash
npx supabase@3.0.0 start
npx supabase@3.0.0 db reset && npx supabase@3.0.0 test db
bash scripts/db/test-importer.sh
npx supabase@3.0.0 db reset && npx supabase@3.0.0 test db && bash scripts/db/test-committed.sh   # then db reset again
npm run typecheck && npm run lint && npm test && npm run build && npm run guard:secrets -- --dist dist
```
