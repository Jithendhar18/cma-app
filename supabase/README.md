# Database (Supabase)

The database behind CMA Study OS accounts: the shared, verified curriculum, each student's own study data, and the security rules that keep one
student's data away from every other student. **Design and review history:** `docs/architecture/`. **Deployment:**
`docs/deployment/production-launch-runbook.md`.

**Status.** Everything here runs and is tested against a throwaway **local** stack in Docker. **No hosted project has been created, no migration
has been applied to one, and nothing in this repository has been tested against one.** Account sign-in in the app is behind a feature flag that is
off by default. The real CMA Intermediate curriculum is **draft-only**: it is not offered to any student until a human has verified it and it has
been published in a controlled, staged way (see "Curriculum" below).

## What the database is used for

| Area | What it holds |
| --- | --- |
| Shared curriculum (13 tables) | courses, syllabus versions, course-syllabus links, exam attempts, attempt availability, subject groups, subjects, sections, chapters, official weightages, study resources, source references, import batches. Readable by signed-in users only when `published` or `retired`; writable by nobody through the API. |
| The student | `profiles` (display name, picture, time zone), `user_settings`, `student_enrollments` (course, attempt, the student's own exam and final-revision dates), `enrollment_groups` |
| Study data | `chapter_progress`, `planner_sessions`, `study_sessions` (focus time), `revisions`, `practice_records`, `mock_tests`, and `local_import_runs` (which explicit local imports were done) |
| Derived views | `chapter_stats`, `daily_study_minutes`, `enrollment_options` (all `security_invoker`, so the caller's own access applies) |
| Functions | the five enrolment functions, `delete_my_account()`, `handle_new_user()`, the quota functions and the publish/immutability guards |
| Quotas | per-account row limits, enforced by triggers (for example 20,000 focus records and 50,000 rows in total) |

## The migrations, in execution order

All six are in `supabase/migrations/`. There is no seed data: `seed.sql` is intentionally empty.

| # | File | What it does |
| --- | --- | --- |
| 1 | `20261108000100_baseline_hardening.sql` | Default deny for `anon` and `authenticated`; the shared `set_updated_at()` trigger function |
| 2 | `20261108000200_shared_curriculum.sql` | the 13 shared tables, the publish gate, readiness (`csv_is_ready`), status-regression and delete guards |
| 3 | `20261108000300_shared_curriculum_rls.sql` | curriculum RLS and grants |
| 4 | `20261108000400_personal_data.sql` | profiles, settings, enrolments, study-data tables, views, enrolment functions, `delete_my_account()`, the signup trigger, date bounds, `updated_at` and immutability triggers |
| 5 | `20261108000500_personal_data_rls.sql` | personal-data RLS (own rows only), column grants, function grants |
| 6 | `20261108000600_personal_quotas.sql` | per-account row quotas |

## Run it locally

Requires Docker, Node 22.12+ and `psql`. Use the pinned CLI (it is deliberately not an app dependency). **CLI 3.0.0 acts on the local stack
unless you pass `--remote`**; never pass `--remote`, and never run `supabase link`, as part of day-to-day work.

```bash
npx supabase@3.0.0 start          # first run pulls Docker images
npx supabase@3.0.0 db reset       # rebuild the LOCAL database from the six migrations (+ the empty seed)
npx supabase@3.0.0 test db        # pgTAP: schema, RLS, integrity, quotas, deletion guard, non-destructive guarantees (789 tests)
npx supabase@3.0.0 db lint --schema public --level warning
npx supabase@3.0.0 stop
```

Database scripts (all local only; each reads the local URL and public key from `supabase status` and refuses any host that is not `127.0.0.1` or
`localhost`):

| Script | What it proves |
| --- | --- |
| `bash scripts/db/test-importer.sh` | the curriculum importer against the real database, using the FAKE fixture (rolled back) |
| `bash scripts/db/test-real-bundle.sh` | the real CMA Intermediate bundle imports as drafts and stays invisible to students (rolled back) |
| `bash scripts/db/test-staged-publication.sh` | Group I published first, Group II later, ids unchanged (rolled back, test-only verifier) |
| `bash scripts/db/test-auth-integration.sh` | real GoTrue, the signup trigger, PostgREST and RLS, driven by the app's own auth code |
| `bash scripts/db/test-sync-integration.sh` | enrolment, sync, batching, import, export and account deletion against the real local stack. It installs the FAKE curriculum fixture, removes it afterwards, and refuses to start unless every shared curriculum table is empty |
| `bash scripts/db/test-two-tab.sh --mutate` | two real Chrome pages and a sign-out in one of them; also proves the test fails when the unbinding protections are removed. Needs Chrome (`CHROME_PATH` to override) |
| `bash scripts/db/test-committed.sh` | real commits: quota races and enrolment flows. Run it after `test db`, and **run `supabase db reset` afterwards**, because it leaves its fixture committed |

The local stack has no mail server, so email delivery and the code exchange from a real email link cannot be tested here.

## What is here

```text
supabase/
  config.toml                    LOCAL stack only (see "Local configuration is not hosted configuration")
  migrations/                    the six migrations above
  seed.sql                       intentionally EMPTY: no curriculum is ever seeded here
  curriculum/                    the curriculum bundles and shared sources and attempts (see its README)
  tests/database/                pgTAP tests (run by `supabase test db`)
scripts/curriculum/              validator, SQL generator and CLI (pure TypeScript, Vitest-tested)
scripts/db/                      the database integration scripts above
```

## Security model in brief

- **Authenticated users only.** `anon` has no access to any table or function. `authenticated` is granted exactly what each migration names
  (the migrations `…000300` and `…000500` are the source of truth; `docs/architecture/rls-security.md` is the original design), column by
  column where a table is only partly editable.
- **Row level security on every table.** A student can read and write only their own rows. Foreign keys additionally stop a row from pointing at
  another user's data or another syllabus.
- **Enrolment is changed only through the five database functions**; there is no direct insert into `student_enrollments`.
- **Signup trigger.** `on_auth_user_created` (after insert on `auth.users`) runs `handle_new_user()`, a `SECURITY DEFINER` function that creates
  the user's `profiles` and `user_settings` rows. The display name comes from sign-up metadata, is trimmed to 80 characters, and falls back to the
  email's local part and then to "Student". The browser never inserts a profile.
- **Account deletion.** `delete_my_account()` refuses unless the access token shows a **password** sign-in within the last 5 minutes (error
  `P0401`), then deletes the auth user; every personal row goes with it and the shared curriculum is untouched.
- **No service-role key in the browser, the repository, CI or Vercel.** Only the public anon or publishable key is ever used by the app.

## Curriculum

The curriculum JSON in git is the source of truth; the database is a deployed copy. **The real bundle is draft-only** until a person verifies it
against the official documents and it is published in stages (Group I first, Group II later). Never fill in `verifiedBy` on someone else's behalf.

```bash
# both verified in this repository
npm run curriculum:validate -- supabase/curriculum/bundles/cma-intermediate-2022 --shared supabase/curriculum/shared
npm run curriculum:sql -- supabase/curriculum/bundles/cma-intermediate-2022 --shared supabase/curriculum/shared --out <file-outside-the-repo>
```

The SQL generator refuses a fake bundle without `--allow-fake` and never writes into `migrations`. Generated SQL is not committed. Format, rules and
the publication process: `docs/architecture/curriculum-seeding.md` and `supabase/curriculum/README.md`.

## Rules this directory follows

- **No sample or invented curriculum in the student-facing dataset.** Tests use a FAKE fixture (`scripts/curriculum/__fixtures__/fake-bundle`, keys
  start `fake-`), inside rolled-back transactions or removed afterwards; `099_no_fixture_leak.test.sql` proves it never persists.
- **Nothing unverified is published.** The publish gate needs `verified_at` and a source reference; a course and syllabus cannot be published until
  it is ready; an attempt cannot be enabled until everything behind it is real.
- **Imports are idempotent and non-destructive.** Removal is a status change to `retired`; published and retired rows cannot be deleted,
  truncated or sent back to draft.
- **All DDL goes through migrations.** Do not create tables in a dashboard: objects created by another role would not inherit the default-deny
  settings from migration 1.

## Changing migrations: review requirements

- Migrations are **forward-only**. Never edit an applied migration; add a new one.
- Every new table needs RLS and explicit grants in the same change; every new function needs an explicit `EXECUTE` decision and, if
  `SECURITY DEFINER`, an ownership check on `auth.uid()` and `set search_path = ''`.
- A migration change needs: a pgTAP test, `supabase test db` green, `supabase db lint` clean, and a maintainer review of privileges before merge.
- CI runs these on a local stack inside the runner only.

## Hosted projects: manual, reviewed, backed up

- **Hosted changes are made only by the maintainer, by hand, after a backup and explicit approval.** No automation applies a migration to a hosted
  project. **CI must never run `supabase link`, `supabase db push --remote`, or any `--remote` command**, and it holds no hosted credential
  (`.github/workflows/database.yml` fails if `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` or `PGPASSWORD` is present).
- Before applying anything to a hosted project: record a backup or baseline, review the dry run
  (`supabase db push --remote --dry-run`, which shows what would be applied and applies nothing, but does connect to the hosted project), and
  take the maintainer's explicit approval. After applying: verify the schema, grants, RLS, functions and triggers.
- The test and fixture scripts are for the local stack only. Never point `supabase test db`, the fixture scripts or the integration scripts at a
  hosted project.
- Step by step: `docs/deployment/production-launch-runbook.md`.

## Local configuration is not hosted configuration

`config.toml` configures the **local** stack only. It is **not** applied to a hosted project. These must be set separately in the hosted
dashboard, on purpose and reviewed: Auth site URL and the redirect allow-list, email confirmation on, minimum password length (the app expects
10), sign-up enabled or paused, SMTP and email templates, rate limits, JWT expiry and refresh-token rotation, the API's maximum rows (the app pages
explicitly and does not depend on it), and the PostgreSQL major version (the local stack runs 17). The list and the order are in the runbook.
