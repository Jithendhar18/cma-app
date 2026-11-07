# Phase 2 — Implementation Plan (design only)

Status: proposal. Nothing here has been started. It sequences the design in `database-schema.md`, `rls-security.md`, `curriculum-seeding.md` and `frontend-migration.md` into small, independently testable milestones.

Ground rules for every milestone:

- The app keeps working in local mode at every step. No milestone ends with the existing UI broken.
- Every milestone ends green on the existing CI (`typecheck`, `lint`, `test`, `build`) plus whatever the milestone adds.
- No milestone uploads demo data, scrapes anything, adds an AI service, or puts a secret in the repository or the frontend.
- One milestone per pull request series; each is releasable on its own.

## 1. Milestones

### M0 — Decisions and data collection (starts now, runs in parallel)

Scope: answer the open decisions in section 7; create the free Supabase project (kept unlinked from the app); begin **manually** collecting official sources for the first curriculum bundle.

Acceptance:

- Decisions D1–D8 recorded (§7).
- A list of official source pages and documents identified for CMA Intermediate, Syllabus 2022, with `retrievedOn` dates, ready to become `sources.json`.

### M1 — Database foundation (no schema yet, no app changes)

Scope: `supabase/` directory, Supabase CLI configuration, migration naming and review conventions, local stack instructions, the baseline hardening migration (revoke default privileges, extensions, `set_updated_at()`), pgTAP set-up.

Depends on: M0 (project choice and Postgres version).

Acceptance:

- `supabase start` and `supabase db reset` succeed locally on a clean checkout.
- `supabase test db` runs (with one trivial test) and passes.
- A test proves `anon` and `authenticated` have **no** privileges on a freshly created `public` table (default deny holds).
- No application source files are touched.

### M2 — Shared curriculum schema, constraints, RLS, importer

Scope:

- Migrations for the 13 shared tables, the publication gate, `csv_is_ready()`, the `enabled` trigger, deferrable ordering constraints.
- RLS (read-only for `authenticated`, nothing for `anon`).
- `scripts/curriculum/validate.ts` and `generate-sql.ts` with Vitest tests.
- A **fake fixture bundle** (clearly labelled, used only by tests) to exercise import, re-import, update, retire and rollback.

Depends on: M1.

Acceptance:

- pgTAP: foreign-key scope tests (a subject cannot reference another syllabus's group; a chapter's section must be in the same subject; weightage targets match their level; cannot publish without `verified_at` and a source).
- pgTAP: `authenticated` cannot insert, update or delete any curriculum row; cannot see `draft` rows; cannot read `curriculum_import_batches`.
- Importer: importing the fixture twice produces identical data and one batch; a revised fixture updates in place; a removed chapter becomes `retired`, never deleted; the generated SQL contains no `DELETE`, `TRUNCATE` or `DROP`.
- Validator rejects every invalid case listed in `curriculum-seeding.md` §4, each with a unit test.
- **No real curriculum data exists in the repository yet.**

### M3 — Personal schema, RLS, RPCs, views

Scope: the 11 personal tables with composite keys, check constraints, the immutable-columns trigger, all RLS policies, `handle_new_user`, the enrolment RPCs, `delete_my_account`, and the three views (`chapter_stats`, `daily_study_minutes`, `enrollment_options`).

Depends on: M2.

Acceptance:

- The full RLS catalogue in `rls-security.md` §8 passes as pgTAP tests.
- Cross-user references are rejected by foreign keys even with RLS temporarily disabled in the test.
- `create_enrollment` rejects unsupported, disabled and unready combinations and cross-syllabus groups; `change_enrollment_attempt` refuses a different syllabus; only one active enrolment per user.
- Inserting the same `client_id` twice yields one row.
- Revision invariants: not both completed and cancelled; one pending revision per chapter; unique live revision number.
- `chapter_stats` matches a hand-computed fixture; every view is `security_invoker` (asserted).
- Deleting an account removes all personal rows and no curriculum rows.

### M4 — CI for the database and curriculum

Scope: extend GitHub Actions per §9: a `curriculum` job and a `db` job, path-filtered, no secrets.

Depends on: M2 (for the validator), M3 (for DB tests); can be added incrementally.

Acceptance:

- A pull request touching `supabase/**` or `scripts/curriculum/**` runs the new jobs and fails when a migration, a pgTAP test or a bundle is broken (demonstrated with a deliberately broken branch).
- The existing app job is unchanged and still passes in the same time budget.
- The workflow uses `contents: read` and references no secret.

### M5 — First verified curriculum bundle (manual, gated on your data)

Scope: `bundles/intermediate-2022/` and `shared/attempts.json` populated **only** from verified sources, via the process in `curriculum-seeding.md` §8; applied to the hosted project from the maintainer's machine.

Depends on: M2, M4; **blocked on the manual verification work from M0.**

Acceptance:

- Validator and CI pass.
- Every published record has `sourceRef` and `verifiedAt`; no chapter weightage exists unless sourced at chapter level.
- The December 2026 attempt has `date_status = unannounced` and null dates unless an official date was verified.
- `enrollment_options` returns exactly: CMA Intermediate → Syllabus 2022 → December 2026 → its verified groups, and **nothing else** (asserted by a test against the hosted or local database).
- A pre-import `pg_dump` of the curriculum tables is saved.

### M6 — Client foundation and authentication (feature-flagged)

Scope: add `@supabase/supabase-js`; client module reading `VITE_SUPABASE_*`; sign-up, sign-in, sign-out, password reset; auth state provider; route guard; profile load. All behind a flag; local mode is the default and unchanged.

Depends on: M3.

Acceptance:

- With the flag off the app is byte-for-byte behaviourally the same: the full existing test suite passes unmodified.
- With the flag on and a mocked client: sign-up creates a session and loads a profile; sign-out clears in-memory personal state; an expired session routes to sign-in; errors are shown, not thrown.
- No service-role key anywhere (a CI grep guards `service_role` and `VITE_` misuse).
- CSP header added to `vercel.json`; the app still loads.

### M7 — Curriculum provider and enrolment

Scope: `CurriculumProvider` with `BundledCurriculum` (today's data) and `SupabaseCurriculum`; replace the 20 hard-coded imports; routes by `slug`; onboarding wizard and an enrolment section in Settings (the four dropdowns, change attempt, change groups, archive, activate); loading, error and empty states.

Depends on: M5, M6.

Acceptance:

- Local mode renders identically (visual and unit tests unchanged).
- The dropdowns show only the options in `enrollment_options`; with no options the screen says enrolment is not open.
- Changing groups hides but never deletes data; changing attempt keeps progress; changing course creates a new enrolment and archives the old; switching back restores it intact (all covered by tests against a local Supabase).
- A confirmation dialog precedes every switch; a running timer blocks switching.

### M8 — Repositories, mappers and the sync engine

Scope: `PersonalRepository`, `EnrollmentRepository`, mapping functions, the diff-based outbox, hydration, idempotent writes, incremental pull and id reconciliation, error handling, Web Locks single-flusher, per-user namespaced local keys, sync status chip. Behind the flag.

Depends on: M7.

Acceptance:

- **Round-trip golden test:** `rowsToSnapshot(snapshotToRows(x))` equals `x` for non-demo data, and the existing analytics, achievement and report selectors return identical results on both.
- Idempotency: the same outbox batch applied twice leaves one row per `client_id`; a focus block logged twice (or completed in two tabs) produces one row per day.
- Failure tests: network down keeps the operation and the local data; 401 pauses without discarding; a constraint violation lands in the dead-letter list and shows a banner; a malformed server row is skipped and reported.
- Midnight: a block crossing midnight syncs as two rows whose minutes sum to the original total.
- Conflict test (two clients editing one `chapter_progress` row) resolves per the chosen policy and loses nothing silently.
- Stale-data test: an older remote row never overwrites a newer local one, and nothing overwrites a key with a pending local operation.
- Timer recovery after refresh still logs exactly once with sync enabled.

### M9 — Local data import, sign-out and account deletion

Scope: the import wizard (backup first, demo excluded, chapter mapping, preview, idempotent import, `local_import_runs`); sign-out with outbox handling and local cleanup; account deletion flow.

Depends on: M8.

Acceptance:

- Import never includes a record flagged `demo`; importing the same file twice adds nothing; unmapped chapter-bound data is skipped and reported.
- A backup file is downloaded before any upload.
- Sign-out with pending writes offers retry, export or discard and never discards silently; after sign-out the per-user local keys are gone and the local-mode data is untouched.
- Account deletion removes all server rows and local keys, leaves the curriculum intact, and signs the user out.

### M10 — Hardening and rollout

Scope: load check with realistic data volumes, query and index review, rate-limit and quota review, security review against `rls-security.md`, documentation, invite-only rollout, rollback plan.

Depends on: M9.

Acceptance:

- Hydration of a heavy user (several thousand rows) completes within an agreed budget on a mid-range phone.
- Free-tier headroom is measured, not assumed (database size per student, requests per session, egress per session).
- Documented runbooks: apply a curriculum update, roll one back, restore from a student export, handle a paused project.

## 2. Sequencing

```text
M0 ──► M1 ──► M2 ──► M3 ──► M4 (can start after M2)
 │              │      │
 │              │      └──────────────► M6 ──┐
 └─ manual data collection ─► M5 ◄── M4      ├─► M7 ─► M8 ─► M9 ─► M10
                                     M5 ─────┘
```

- **M1 to M4 touch no application code**, so they carry no regression risk for the existing UI.
- M5 is limited by your manual verification work, not by engineering. M6 can proceed in parallel with M5.
- M7 needs real verified data (M5) to be meaningful; until then it can be built and tested against the fixture.

**Recommended first milestone: M1 then M2** (the database foundation and the shared curriculum schema with tests and importer). It is fully testable without any account, has no frontend risk, and everything else depends on it.

## 3. Testing strategy

| Area | How it is tested | Where |
| --- | --- | --- |
| RLS and cross-user isolation | pgTAP, acting as two authenticated users and as `anon` (catalogue in `rls-security.md` §8) | M3, runs in CI |
| Course and attempt availability | pgTAP: unsupported, disabled, unready, unverified combinations are not selectable and cannot be enrolled | M2, M3 |
| Curriculum foreign-key integrity | pgTAP: every composite key rejects a cross-scope reference | M2 |
| Duplicate prevention | pgTAP: duplicate `stable_key`, duplicate `client_id`, duplicate resource | M2, M3 |
| Enrolment switching | pgTAP for the RPCs; Vitest against local Supabase for the UI flow, including "nothing is deleted" assertions | M3, M7 |
| Revision scheduling | the existing Vitest suite (unchanged logic) plus pgTAP for the structural invariants (one pending, not both states) | existing, M3 |
| Study-session idempotency | pgTAP (same `client_id` twice) and Vitest (same outbox batch twice, two tabs, refresh) | M3, M8 |
| localStorage migration | Vitest on the mapper and wizard with fixtures: demo excluded, mapping, idempotent re-run, malformed files | M9 |
| Failed network requests | Vitest with a fake client that fails, times out, returns 401, 403, 409, and malformed rows | M8 |
| Cross-tab synchronisation | Vitest for the lock and key namespacing; the existing two-tab browser flow re-run with sync enabled | M8 |
| Preservation of analytics | golden test: identical selector outputs for a snapshot and its database round-trip | M8 |
| Curriculum importer | Vitest on the validator and generator; CI applies the fixture to a local database twice | M2, M4 |

Conventions: tests never touch a hosted project; each DB test runs in a rolled-back transaction; pgTAP fixtures are created in the test, never shared.

## 4. Risks

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| 1 | Curriculum verification takes longer than engineering | high / schedule | M1–M4 proceed independently; the fixture lets M7 and M8 be built |
| 2 | Phase 1 progress cannot be mapped to official chapters | certain / user data | explicit mapping wizard; backup first; unmapped data stays in the backup |
| 3 | A composite foreign-key design is hard to evolve | medium / maintenance | each scope key is a unique constraint; migrations tested from scratch in CI |
| 4 | Sync engine complexity and subtle bugs (the biggest engineering risk) | medium / data trust | idempotent writes, server unique constraints as the final guard, golden and failure tests, behind a flag until proven |
| 5 | Free-tier pause or quota exhaustion | medium / availability | measure usage in M10; exports as backup; keep-alive decision (D8) |
| 6 | No automatic backups on the Free plan (**verify**) | medium / data loss | student export, manual `pg_dump` of curriculum, upgrade path if usage grows |
| 7 | Email confirmation limits block sign-ups | medium / onboarding | custom SMTP or closed beta (D3) |
| 8 | Auth token in localStorage is exposed to XSS | low / account takeover | CSP, no HTML injection, dependency hygiene |
| 9 | RLS policy mistakes | low / high | defence in depth: default-deny grants, composite keys, immutable-columns trigger, black-box tests in CI |
| 10 | Vercel Hobby restricts commercial use (**verify**) | depends on intent / compliance | decide before launch (D10) |
| 11 | Supabase CLI and Docker in CI are slower or flakier than the app job | medium / CI time | path filters, caching, separate job so the app job is never blocked |
| 12 | Scope creep into an admin UI, realtime, cross-device timers | medium / schedule | explicitly out of scope; revisit after MVP |

## 5. What stays out of scope

An admin dashboard, realtime multi-device updates, cross-device live timers, file storage or hosting of documents, scraping, AI features, social or sharing features, payment, carrying progress across syllabus versions automatically, and the CMA Intelligence notices feed (it remains demo content).

## 6. Dependencies added

Exactly one runtime dependency across Phase 2: `@supabase/supabase-js` (in M6). The Supabase CLI is a development and CI tool, not an application dependency. Nothing else is planned (no TanStack Query, no Zod, no state library).

## 7. Decisions requiring your approval

Recommendations are in bold.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Enrolments per student | one active + history; or several active | **one active, any number archived** (simpler, matches today's one-exam focus) |
| D2 | Keep local-only mode after accounts launch | keep; or require an account | **keep through the MVP** (zero-cost fallback, protects existing users) |
| D3 | Email confirmation | on with custom SMTP; on with the built-in sender; off for a closed beta | **on, with a free custom SMTP** if usage grows; off only for a small invited beta |
| D4 | Avatar | database data URL (≤ ~60 KB); local only; Supabase Storage | **database data URL** (no Storage use; already size-capped on the client) |
| D5 | Conflict policy for mutable rows | field-level three-way merge; or server wins with a reported local loss | **server wins + report for the MVP**, adding the merge only if real conflicts occur |
| D6 | Detecting deletions on other devices | periodic id reconciliation; or tombstone columns | **reconciliation** (no schema complexity; cheap at this scale) |
| D7 | Cross-device live timer | out of scope; or sync running state | **out of scope** (completed blocks sync; a running block stays on its device) |
| D8 | Keep-alive against free-tier inactivity pause | do nothing; or a scheduled ping | **do nothing at first**; decide after measuring real usage, because a scheduled job is the "background job" you asked to avoid |
| D9 | Account deletion mechanism | definer RPC; or a small Edge Function | **definer RPC** if the platform permits it (**verify**), else the Edge Function |
| D10 | Hosting terms | Vercel Hobby; or a plan that permits commercial use | decide based on whether the app will be commercial |
| D11 | Who verifies curriculum | you alone with a delayed second pass; or a second person | **a second person if available**; otherwise a delayed self-review with the checklist |
| D12 | Phase 1 chapter-bound data on import | mapping table; auto-match; skip chapter data | **mapping table, with "skip chapter-bound data" as fallback** |
| D13 | Group selection rules | any non-empty subset of a CSV's groups; or restrictions per course | **any non-empty subset** (add a rules table only when a real restriction exists) |
| D14 | `suggested_study_hours` | keep as nullable app-provided hint; or drop | **keep nullable**; never shown as official |
| D15 | Supabase region | closest to students; or default | choose the nearest available region (**verify** availability in India) |

## 8. Free-tier infrastructure

**Every figure below is from memory of the providers' published free plans and must be verified against current documentation before relying on it.** Limits and terms change.

### 8.1 Services

| Service | Role | Plan |
| --- | --- | --- |
| Supabase | PostgreSQL and Auth | Free |
| Vercel | static frontend hosting | Hobby |
| GitHub | source and CI | Free |

No always-on server, no paid AI or scraping service, no object storage, no custom domain, and no scheduled job is required.

### 8.2 Limits to verify

| Item | Believed free-plan value | Why it matters here | Status |
| --- | --- | --- | --- |
| Supabase database size | about 500 MB per project | the capacity estimate in `database-schema.md` §7 (about 1–3 MB per student-year) | **verify** |
| Supabase monthly active users | about 50,000 | far above any plausible need | **verify** |
| Supabase egress | a few GB per month | sync is incremental to protect this; measure in M10 | **verify** |
| Supabase file storage | about 1 GB | unused by design | **verify** |
| Supabase projects | a small number of active projects | one is needed | **verify** |
| Inactivity pause | projects pause after about a week without activity | an off-season pause would stop the app until restored | **verify**; decision D8 |
| Backups | not included on the free plan | no point-in-time recovery; relies on exports and manual dumps | **verify** |
| Auth emails | built-in sender with a low hourly cap | blocks classroom-scale sign-ups | **verify**; decision D3 |
| API rows per request | default cap (about 1,000) | hydration must paginate | **verify** |
| Auth rate limits | per-endpoint caps | affects sign-up bursts | **verify** |
| Edge functions | a monthly invocation quota | only used if D9 chooses a function | **verify** |
| Vercel Hobby use | personal, non-commercial | may not permit a commercial product | **verify** terms; decision D10 |
| Vercel Hobby bandwidth and builds | monthly caps | static app, small | **verify** |
| GitHub Actions minutes | private repos have a monthly allowance; public repos are unmetered | a DB job with Docker costs more minutes | **verify** |

### 8.3 Operational risks

1. **Pause after inactivity** can make the hosted database unavailable until someone restores it. The local-first design means students keep working offline and sync resumes afterwards, which is a major benefit of the architecture.
2. **No backups.** Mitigated by the existing student export, the pre-import curriculum dump, and the curriculum living in git. Personal data loss from a platform incident would not be recoverable by us.
3. **Quota exhaustion** is unlikely at small scale, but the sync design (incremental pulls, small ID-only reconciliation, coalesced writes, no realtime, no storage) is chosen to keep requests and egress low.
4. **Single project, single environment.** There is no staging database on the free plan beyond the local stack, so migrations are tested locally and in CI before being applied to the one hosted project, with a manual dump first.
5. **Terms of service** for Hobby hosting and any "keep-alive" practice need checking before launch.

## 9. Extending GitHub Actions CI later (without production credentials)

The current `ci.yml` stays as it is. Add two path-filtered jobs, in separate files or the same workflow with `paths` filters, so app-only changes never wait on Docker.

### 9.1 `curriculum` job (no database)

- Triggers when `supabase/curriculum/**` or `scripts/curriculum/**` changes.
- Steps: `npm ci`, run the validator over every bundle, run the Vitest suite for the validator and generator, run the generated-SQL scan (no `DELETE`/`TRUNCATE`/`DROP`, no personal table names).

### 9.2 `db` job (local Supabase in the runner)

- Triggers when `supabase/**` changes.
- Steps: check out; set up the Supabase CLI with the official setup action; `supabase start` (uses Docker, which `ubuntu-latest` provides); `supabase db reset` (replays every migration and the seed from scratch); `supabase test db` (pgTAP); `supabase db lint`; a schema-drift check; `supabase stop`.
- It uses **only the throwaway keys that `supabase start` prints for the local stack**. No hosted project is contacted and **no secret is configured**.
- An optional second step runs the repository and sync integration tests against that local stack, passing the local URL and local anon key as environment variables inside the job.

### 9.3 Safety properties

- `permissions: contents: read`, as today.
- Pull requests from forks never receive repository secrets (the default), and these jobs need none.
- Pin third-party actions to commit SHAs and keep them updated with Dependabot.
- Branch protection requires the app job always, and the new jobs when their paths change.

### 9.4 Applying migrations to the hosted project

- **MVP: manual.** The maintainer runs the Supabase CLI from their own machine with the database password, after taking a dump. No production credential lives in GitHub.
- **Later, if automation is wanted:** a separate `workflow_dispatch` workflow that runs only on `main`, bound to a GitHub **Environment** named `production` with required reviewers and environment-scoped secrets (access token, project ref, database password). Never triggered by pull requests, and still never automatic deployment of the frontend (Vercel handles that separately).
