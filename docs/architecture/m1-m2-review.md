# M1 + M2 Review Package

Status: **approved, with the decisions in section 8 implemented.** Committed locally as M1 + M2. Not pushed, not deployed, no hosted project.

Scope delivered: M1 (database foundation) and M2 (shared curriculum schema, RLS, importer). No student tables, no
authentication, no frontend change, no hosted project.

## 1. What was built

| Area | Files |
| --- | --- |
| Local stack config | `supabase/config.toml` (no Realtime, Storage, Edge Functions, Studio, SMTP, analytics; password minimum 10) |
| Migrations | `supabase/migrations/20261108000100_baseline_hardening.sql`, `…000200_shared_curriculum.sql`, `…000300_shared_curriculum_rls.sql` |
| Seed | `supabase/seed.sql`: **intentionally empty** |
| Database tests | `supabase/tests/database/000`–`007`, `099` (pgTAP) |
| Importer | `scripts/curriculum/{types,validate,generate-sql,bundle-io,cli}.ts` |
| Importer tests | `scripts/curriculum/{validate,generate-sql}.test.ts` (Vitest), `scripts/db/{build-import-test-sql.ts,test-importer.sh}` (real database) |
| Fake fixture | `scripts/curriculum/__fixtures__/fake-bundle/` |
| Tooling | `tsconfig.scripts.json`, `vite.config.ts` (test include), `package.json` scripts, `@types/node` dev dependency |
| Docs | `supabase/README.md`, this file |

No file under `src/` was changed. The existing UI, stores and local mode are untouched.

## 2. Schema summary (13 shared tables, no personal data)

`source_references`, `curriculum_import_batches`, `courses`, `syllabus_versions`, `course_syllabus_versions` (CSV),
`exam_attempts`, `course_attempt_availability`, `subject_groups`, `subjects`, `syllabus_sections`, `chapters`,
`official_weightages`, `study_resources`.

- **Course, syllabus version and attempt are separate concepts.** `exam_attempts` has no course or syllabus column; the
  only thing that makes an attempt selectable is a row in `course_attempt_availability`.
- **Scope is proven by composite foreign keys** on `csv_id` (subject→group, section→subject, parent section in the same
  subject, chapter→subject and section, weightage targets, resource scope). A row cannot point at another syllabus.
- **Publish gate** on every publishable table: `status = 'published'` requires `verified_at` and a source reference.
- **Readiness:** `csv_is_ready()` and a trigger refuse to publish a CSV unless the course and syllabus are published and
  every published group, subject has verified children down to chapters. Availability can only be enabled for a
  published, ready CSV and a published attempt.
- **Weightages** are stored at exactly the level published (`subject`/`section`/`chapter`, one target, matching level).
  Nothing derives or spreads them; a test asserts no function or trigger writes weightages.
- **Dates:** syllabus `effective_from` and attempt dates are nullable, with `date_status` defaulting to `unannounced`.
- **Verifier (S7):** every publishable table has `verified_by`, a maintainer handle such as a GitHub username
  (`^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`, so an email address or free text is rejected). Publishing requires `verified_at`,
  `verified_by` and a source reference. The importer preserves a recorded verifier unless verification is explicitly repeated.
- **Positions are unique among active rows only.** Chapter order, subject paper numbers and slugs, section order and group
  order use partial, deferrable exclusion constraints (and partial unique indexes), so a retired row never blocks the row that
  replaces it, and two rows can still swap position inside one import transaction.

## 3. Non-destructive guarantees (enforced by the database, not just the importer)

| Guard | Mechanism |
| --- | --- |
| Published or retired rows cannot be deleted | `BEFORE DELETE` trigger (only drafts are deletable) |
| Status cannot regress to draft | `BEFORE UPDATE OF status` trigger (closes "un-publish then delete") |
| No `TRUNCATE` | statement-level trigger on all 13 tables |
| `id` and `stable_key` immutable | `BEFORE UPDATE` trigger |
| Referenced rows | every foreign key is `ON DELETE RESTRICT` (asserted: no cascading FK) |
| Importer never removes | removal is `status = 'retired'`; generated SQL is scanned for row removal, truncation, drops, GRANT/REVOKE, `auth.` and any student table |
| Never downgrades or un-verifies | importer uses `case` for status and `coalesce` for verification (including `verified_by`); DB guards back this up |
| Retire-all protection (S11) | an import that would retire **every** active record in a scope aborts, naming the scope and count, unless `--allow-retire-all` is passed; the guard runs before any change, inside the import transaction |

## 4. RLS and grants (actual)

| Role | Access |
| --- | --- |
| `anon` | nothing on any public table; cannot call any public function |
| `authenticated` | `SELECT` only. Curriculum tables: `status IN ('published','retired')`. Availability: `enabled`/`disabled`. Resources: also `link_status = 'active'`. Drafts never visible |
| `authenticated` writes | none: no INSERT/UPDATE/DELETE/TRUNCATE grant and no such policy |
| `source_references` | column grant excludes internal `note`; `select *` is refused |
| `curriculum_import_batches` | RLS on, no policy, no grant (unreachable via the API) |
| Functions | only `csv_is_ready(uuid)` is executable by `authenticated`; every other function is not callable by API roles |

Default deny (M1): default privileges on tables, sequences and functions are revoked from `anon` and `authenticated`, **including
the global `PUBLIC` execute default**, which the first draft of the migration missed (found by the tests, see §6).

## 5. Test results (measured on the committed state)

| Check | Result |
| --- | --- |
| pgTAP (`supabase test db`) | **211 assertions in 9 files, all pass** |
| Importer against the real database (`scripts/db/test-importer.sh`) | **passes**: idempotent re-import with unchanged ids; in-place update; retire not delete; rollback by re-importing the previous version; never-downgrade; verifier preserved, and replaced only when verification is repeated; late failure is atomic; retire-all refused with scope and count, then accepted with the override; replacements take retired rows' positions; stand-in student reference survives; incomplete bundles refused by the database; nothing persists |
| Vitest, importer (`scripts/curriculum`) | **94 tests pass** (validator incl. verifier rules, generator incl. retire-all guard, escaping, safety scan, hashing, fixture-never-in-migrations) |
| Vitest, existing app (`src/**`) | **166 tests pass, unchanged** |
| Vitest, total | **260 tests pass** |
| TypeScript (`npm run typecheck`) | 0 errors, covering `src/` and `scripts/` |
| ESLint | 0 findings |
| Production build | succeeds |
| `supabase db lint --level warning` | no schema errors |
| Local reset from scratch | all 3 migrations apply cleanly, repeatedly |
| `src/` changed? | **no** |
| Fake fixture in migrations or seed? | **no** (asserted by `099_no_fixture_leak` and by Vitest, which also requires `seed.sql` to contain no statements) |

### Mutation testing (proof the tests can fail)

Each protection was deliberately broken in the live local database and the suite re-run. **23 of 23 breaks were caught, none
survived:** write grant plus permissive policy; draft filter removed; import batches exposed; `anon` granted read; guard function
made callable; global `PUBLIC` execute default restored; default table privileges restored; delete guard dropped; truncate guard
dropped; status-regression guard dropped; publish gate dropped; **verifier requirement removed from the gate**; **`verified_by`
format check dropped**; chapter-to-section key dropped; subject-to-group key dropped; readiness trigger dropped; `stable_key`
guard dropped; RLS disabled; note column made readable; **chapter and section active-position exclusions dropped**; **slug
uniqueness made global**; **resource uniqueness removed**.

The importer was sabotaged the same way (a generator that never retires, downgrades published rows, erases verification, erases
the verifier, disables the retire-all guard, or compares after the upserts). All were caught. Two initially survived and exposed
gaps in my own tests, which are now closed (never-downgrade was untested; the "unverified draft" scenario forgot to clear the
verifier).

## 6. Defects found by the tests during this work (all fixed)

1. **Function privileges leaked.** `IN SCHEMA public` cannot revoke the global `PUBLIC` execute default, so every function was
   callable by `anon`. Fixed with a schema-less `ALTER DEFAULT PRIVILEGES` plus an explicit sweep.
2. **`updated_at` used `now()`**, frozen at transaction start, which could make an incremental sync miss rows. Now `clock_timestamp()`.
3. **Importer retire lists followed JSON order**, so identical content produced different SQL. Now sorted.
4. **Generated SQL comments contained the words "delete" and "drops"**, which would trip a grep-based CI scan. Reworded.
5. **Un-publish-then-delete loophole.** Added the status-regression guard.
6. **Importer test gaps** (never-downgrade untested; the unverified-draft scenario did not clear the verifier). Closed.
7. **A retired row blocked its own replacement.** Retired chapters kept their position, slug, paper number and link, so a re-keyed
   or replaced record could never take its place. Found while designing the retire-all test (a full re-key is exactly that
   case). Positions, slugs and links are now unique among active rows only (see section 2).

## 7. Deviations from the approved design

| Design | As built | Reason |
| --- | --- | --- |
| CSV had no key | `course_syllabus_versions.stable_key` (= the bundle key) | the importer must address a CSV by key |
| Weightages had no key | `official_weightages.stable_key` | needed to update and retire idempotently |
| `curriculum_import_batches` makes a re-run "a no-op" | re-running is **harmless** (every statement is idempotent); the batch row is an audit record unique per content hash | a conditional skip would add complexity for no safety gain |
| Availability: shared gate | `verified_at` and `source_reference_id` columns, enable gate | consistent with the publish gate |
| `stable_key` as plain text | domain `curriculum_key` (lower-case, digits, `. _ -`, max 120) | enforced in one place |
| Statuses: one vocabulary | curriculum `draft/published/retired`; availability `draft/enabled/disabled` | availability is a configuration, not a document |
| Postgres "15 or newer" | local stack runs **17** (CLI default) | hosted project must match; see §8 |
| Importer CLI `--shared` etc. | `bundle.json` holds `course`, `syllabus`, `courseSyllabus` each with status, source, verification | simpler than a separate verification block |
| (new) | status-regression guard, truncate guard, `source_references.updated_at` | non-destructive rule, found while testing |
| Uniqueness as `UNIQUE` | partial, deferrable **exclusion constraints** for positions, partial unique indexes for slug, weightage target and resource scope | a retired row must not block its replacement (defect 7) |
| `verified_at` + source gate | `verified_at` + **`verified_by`** + source gate (S7) | decision S7 |
| Retire-all: validator refusal only | validator refusal **plus** `--allow-retire-all` override and a database guard (S11) | decision S11 |

## 8. Decisions (final)

| # | Decision | Status |
| --- | --- | --- |
| S1 | Target PostgreSQL 17 locally and on the hosted project. Confirm hosted 17 is available before creating the project; if not, align local environment and tests with the hosted major version before deployment. | **Local runs 17.** Hosted availability is **not yet confirmed**: no hosted project exists and none will be created without your approval. Tracked as a pre-deployment check. |
| S2 | Only the maintainer runs hosted migrations, manually, from a trusted machine, after a database backup. MFA mandatory. No production database credentials in GitHub or the repository for the MVP. | Process rule. The new database workflow refuses to run if a hosted credential appears in its environment. |
| S3 | `anon` must not read curriculum. Local mode stays available without authentication. | Implemented and tested. |
| S4 | The service-role key must never enter frontend code, browser requests, Git or client-side environment variables. CI guard in M4. | Guard written in M4 (scans tracked files and the built bundle). See `m3-m4-review.md`. |
| S5 | All DDL through version-controlled migrations. No dashboard-created objects. | Process rule, documented in `supabase/README.md`. |
| S6 | Keep `source_references.note` private; require explicit column selection. | Implemented and tested. |
| S7 | Add `verified_by`, require it for published records, use a maintainer identifier such as a GitHub handle, preserve it unless verification is repeated. | **Implemented and tested** (schema, importer, fixture, database and importer tests). |
| S8 | Authenticated reads confirmed, provided source metadata and links are intended for students and contain no private information. | Confirmed. `verified_by` is a handle (email addresses are rejected by a check), readable by signed-in users; switch to column grants if you ever want it hidden. |
| S9 | Fake fixtures and test helper schemas run only against local/test databases; keep remote-host protection. | Confirmed. The importer script refuses non-local hosts; the CI database job also checks that no hosted credential is present. |
| S10 | Enable email confirmation, 10-character minimum, exact redirect URLs, test confirmation and reset, verify SMTP before rollout. | **Partly done.** `config.toml` now has confirmation on, minimum 10, site URL set, and no wildcard redirect URLs. Confirmation and reset **cannot be tested until the sign-up flow exists (M6)**, and SMTP must be verified on the hosted project. Tracked for M6. |
| S11 | Keep the empty-bundle validation. Add `--allow-retire-all` for an import that would retire all active records in a scope; show scope and count; keep the import transactional. | **Implemented and tested** (generator, CLI, database test with atomic rollback). |

## 9. How to reproduce

```bash
npx supabase@3.0.0 start
npx supabase@3.0.0 db reset && npx supabase@3.0.0 test db
bash scripts/db/test-importer.sh
npm run typecheck && npm run lint && npm test && npm run build
```

## 10. Not done in this commit (by design)

M3 (personal tables) and M4 (CI protections) are separate steps and are not in the M1/M2 commit. No authentication, no frontend
integration, no hosted project, no real curriculum bundle. Nothing is pushed or deployed.
