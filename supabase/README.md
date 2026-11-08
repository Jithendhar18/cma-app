# Database (Supabase)

Shared curriculum schema, security policies and tests. **Design:** `docs/architecture/`. **Status:** milestones M1
(foundation) and M2 (shared curriculum) only. There are no student tables yet (M3), and the app does not use this
database yet.

Nothing here talks to a hosted project. Everything runs against a throwaway local stack in Docker.

## Run it locally

Requires Docker and Node 22.12+. Use the pinned CLI (it is deliberately not an app dependency):

```bash
npx supabase@3.0.0 start        # first run pulls Docker images
npx supabase@3.0.0 db reset     # rebuild from migrations (+ the intentionally empty seed.sql)
npx supabase@3.0.0 test db      # pgTAP: schema, RLS, integrity, non-destructive guarantees
npx supabase@3.0.0 db lint --schema public --level warning
bash scripts/db/test-importer.sh   # importer against the real database, with the FAKE fixture
bash scripts/db/test-committed.sh   # real commits: quota races, enrolment flows (after `test db`; then `db reset`)
npx supabase@3.0.0 stop
```

The importer script needs `psql` on the path and refuses to run against anything but `127.0.0.1`/`localhost`.

## What is here

```text
supabase/
  config.toml                    local stack only: no Realtime, Storage, Edge Functions, Studio, SMTP, analytics
  migrations/
    20261108000100_baseline_hardening.sql     default deny for anon/authenticated (M1)
    20261108000200_shared_curriculum.sql      13 shared tables, gates, guards (M2)
    20261108000300_shared_curriculum_rls.sql  RLS policies and grants (M2)
  seed.sql                       intentionally EMPTY: no curriculum is ever seeded here
  tests/database/                pgTAP tests (run by `supabase test db`)
scripts/curriculum/              validator, SQL generator, CLI (pure TypeScript, Vitest-tested)
scripts/db/                      importer integration test against the local database
```

## Rules this directory follows

- **Curriculum JSON in git is the source of truth.** The database is a deployed copy. No scraping, no AI, no scheduled
  jobs, no automatic data collection.
- **No sample or invented curriculum in the student-facing dataset.** Tests use a FAKE fixture
  (`scripts/curriculum/__fixtures__/fake-bundle`, keys start `fake-`, `.invalid` URLs). Every database test rolls
  back, and `099_no_fixture_leak.test.sql` plus a Vitest test prove the fixture never reaches migrations or the seed.
- **Nothing unverified is published.** A publish gate requires `verified_at` and a source reference on every
  publishable row. A course + syllabus version cannot be published until it is ready, and an attempt cannot be
  enabled until everything behind it is real.
- **Imports are idempotent and non-destructive.** Removal is a status change to `retired`. Published and retired rows
  can't be deleted, truncated, or sent back to draft. Referenced rows are protected by `ON DELETE RESTRICT`.
- **All DDL goes through migrations.** Do not create tables in a dashboard: objects created by another role would
  not inherit the default-deny settings from the first migration.
- **Hosted projects are changed only by the maintainer**, by hand, after a backup. No production credential belongs
  in GitHub, the frontend, or this repository.

## Validating and generating curriculum SQL (no real bundle exists yet)

```bash
npm run curriculum:validate -- <bundleDir>
npm run curriculum:sql -- <bundleDir> --out <file>
```

The CLI refuses to produce SQL for a `fake-` bundle unless `--allow-fake` is passed, and never into `migrations`.
