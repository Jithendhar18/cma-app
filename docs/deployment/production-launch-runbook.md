# Production launch runbook: CMA Study OS (one Production environment)

**Status: a plan, not a record.** No hosted Supabase project exists, no migration has been applied anywhere hosted, and nothing in this document has
been rehearsed against a hosted project. Written against `main` at `7bbca94` (M1 to M10 merged, CI green). Re-check this document against `main`
before using it.

**Decision this runbook follows:** exactly **one** hosted Supabase project and **one** Vercel Production deployment. There is no hosted staging
database. The local Supabase stack and CI are the pre-production test environments. Because there is no hosted rehearsal, **every hosted step below
is also the first time it runs**, so each one sits behind an approval gate, is reversible where possible, and is done with accounts that are
disposable.

Reading guide: `[GATE]` marks an approval point. Nothing after a gate is done until the maintainer says so, in writing, for that gate.

**Companion documents (same folder):**
- `production-supabase-recovery.md`: **the operational reference for Supabase availability incidents** (paused project, outage, Auth or database
  failure, email, quota limits, key and CSP errors, Vercel failures, sync backlog), with the backup and restore guidance.
- `account-export-restoration.md`: what an account export contains and why **an account JSON export does not currently provide any automatic
  restore**.

Four statements that apply throughout:
- **Account JSON export is not a restore mechanism.** The application can produce the file; nothing reads it back.
- **Local-mode import is not an account-export restore.** The import wizard reads this browser's local-mode data only, and works through explicit matching.
- **Backup and restore capabilities must be verified against the actual Production plan** before anyone relies on them; this repository does not assume any.
- **Production migrations, backups and any recovery action require maintainer approval**, recorded before the action.

## 0. The rules that never relax

- No service-role key, `sb_secret_` key, database password or Supabase access token in the frontend, the repository, CI or any Vercel variable.
- The auth feature flag stays **`false`** until Gate G9.
- No wildcard in the Content Security Policy. The Supabase origin is the exact Production origin, added by a reviewed PR.
- No hosted migration is applied without a backup/baseline, a reviewed dry run and explicit maintainer approval. CI never applies migrations.
- The real M5 curriculum stays **draft** until a person has verified it. Nobody else fills in `verifiedBy`. Never put fake or sample curriculum in the
  Production database.
- Local-mode data is never uploaded automatically. Only the explicit import wizard moves it.
- Never run the local test, fixture or integration scripts, or `supabase test db`, against a hosted project.
- CLI 3.0.0 acts on the local stack unless `--remote` is passed. **Do not type `--remote` or `supabase link` except at the gate that says to.**

## 1. Environment model

| | Local development and CI | Vercel Preview | Production |
| --- | --- | --- | --- |
| Backend | Local Supabase stack in Docker (`supabase start`) | **None** | One hosted Supabase project |
| App mode | Either (flag on for local account testing) | **Local mode only** | Local mode until G9, then accounts |
| `VITE_SUPABASE_AUTH_ENABLED` | `true` in `.env.local` when testing accounts | **`false` or unset** | `false` until G9 |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | local stack values (never committed; `*.local` is git-ignored) | **not set** | the Production project's values |
| Data | throwaway; fixtures only | browser `localStorage` of each visitor | real students |
| Tests | pgTAP, auth integration, enrolment/sync/portability integration, two real Chrome pages, importer, real-bundle, staged publication, committed behaviour | header test and build only | the controlled smoke test (section 4) |

Consequences, stated plainly:
- **Preview deployments cannot test accounts.** They have no Supabase URL or key, so the app makes no Supabase request and does not download the
  Supabase library. A Preview must never receive Production credentials.
- Everything that can be tested without a hosted project is tested **before** G1 (section 2). Everything left over is in section 7 as an unverified
  assumption, and is exercised for the first time during the Production smoke test.

## 2. Pre-flight (no hosted contact)

Run on the exact commit that will be deployed:

```bash
git fetch origin && git switch main && git pull --ff-only origin main && git log -1 --oneline
npm ci --no-audit --no-fund
npm run typecheck && npm run lint && npm test && npm run build
npm run guard:secrets && npm run guard:secrets -- --dist dist
npm run curriculum:validate -- supabase/curriculum/bundles/cma-intermediate-2022 --shared supabase/curriculum/shared
# local stack (Docker):
npx supabase@3.0.0 start && npx supabase@3.0.0 db reset && npx supabase@3.0.0 test db
npx supabase@3.0.0 db lint --schema public --level warning
bash scripts/db/test-importer.sh && bash scripts/db/test-real-bundle.sh && bash scripts/db/test-staged-publication.sh
bash scripts/db/test-auth-integration.sh && bash scripts/db/test-sync-integration.sh && bash scripts/db/test-two-tab.sh --mutate
bash scripts/db/test-committed.sh && npx supabase@3.0.0 db reset     # committed test leaves its fixture; reset afterwards
```

Expect, at the time of writing: pgTAP 789, auth integration 19, sync/portability integration 31, curriculum importer tests 121, the two-tab test
passing with both mutations detected, and GitHub Actions green on `main`. **[GATE G0]** Confirm the results and that CI on `main` is green.

## 3. Production setup, in order

### 3.1 Create and secure the project
1. **[G1] Create the Production Supabase project** (maintainer, owner account with **MFA enabled**). Choose **PostgreSQL 17** if offered (the local
   stack and every test run on 17; the migrations need 15 or later). Pick the region deliberately; it cannot be changed later. Note the plan: backups
   and restore options depend on it (section 6).
2. Store the **database password** in a password manager. It never goes into the repository, CI or Vercel.
3. Note the project's API URL (`https://<project-ref>.supabase.co`) and its **publishable/anon key** (public) from the dashboard. Do not copy the
   service-role or secret key anywhere.

### 3.2 Review and baseline
4. Re-read all six migrations in `supabase/migrations/` (list in `supabase/README.md`). Confirm no file changed since the audited commit:
   `git diff 7bbca94 HEAD -- supabase/migrations` must be empty.
5. **Baseline backup.** The project is empty, so record that fact (dashboard backup list, project creation time, and the empty `public` schema).
   Record the backup capability of the chosen plan.
6. **Dry run.** Only after G2 below: link the project and print what would be applied. This is the first command that touches the hosted project:
   ```bash
   npx supabase@3.0.0 link --project-ref <ref>                 # prompts for the database password
   npx supabase@3.0.0 migration list --remote                  # read-only
   npx supabase@3.0.0 db push --remote --dry-run               # prints the six migrations; applies nothing
   ```
   **[G2]** The maintainer reviews the dry-run output: exactly six migrations, in this order: `20261108000100_baseline_hardening`,
   `…000200_shared_curriculum`, `…000300_shared_curriculum_rls`, `…000400_personal_data`, `…000500_personal_data_rls`, `…000600_personal_quotas`.

### 3.3 Apply
7. **[G3] Explicit written approval, then apply by hand:**
   ```bash
   npx supabase@3.0.0 db push --remote
   ```
   `db push` does not load seed data unless `--include-seed` is given; do not give it. Do not use `--include-all`.
8. **Verify the database** (read-only SQL in the dashboard SQL editor or `psql`):
   - six rows in the migration history, in order (`migration list --remote`);
   - the 13 shared and 11 personal tables exist, all with RLS enabled;
   - no table or function is executable by `anon`; `authenticated` has the grants listed in `supabase/README.md` and nothing more;
   - the functions in `supabase/README.md` exist; `on_auth_user_created` exists on `auth.users`;
   - the shared curriculum tables are **empty** (the app shows "Enrolment is not open yet").
   **If the `auth.users` trigger is missing or migration 4 stopped**, see section 5.3 and do not continue.
   Optionally run `npx supabase@3.0.0 db lint --remote --schema public --level warning` (read-only).

### 3.4 Hosted Auth configuration (dashboard; none of `config.toml` applies)
9. **[G4]** Set, and have a second person confirm:
   - **Site URL** = the Production origin.
   - **Redirect allow-list**: exactly `https://<prod-origin>/auth/callback` and `https://<prod-origin>/auth/reset-password`. No wildcard. Do **not**
     add Preview origins (Preview has no accounts). For the Phase A smoke test (section 4) temporarily add the two exact `http://localhost:5173/…`
     entries, and remove them afterwards.
   - **Email confirmations: on.** **Minimum password length: 10.**
   - **Sign-ups: start with registration paused** (the dashboard control for new users), so nobody can register before G10.
   - JWT expiry 3600 and refresh-token rotation on (the local values; confirm the hosted defaults are the same).
   - Auth rate limits reviewed.
10. **Custom SMTP.** The hosted default sender is not suitable for production (low sending limits and a shared sender; check the current limits). Configure a real SMTP
    provider with SPF, DKIM and DMARC on the sending domain. Review the confirmation and reset templates: they **must use the default
    `{{ .ConfirmationURL }}`** (PKCE link). A `token_hash` template will not work with this app's callback pages.
    *(The SMTP provider and sending domain are maintainer decisions; none is chosen in this repository.)*

### 3.5 Vercel configuration
11. **Production variables** (Vercel → Project → Settings → Environment Variables, scope **Production only**):
    `VITE_SUPABASE_AUTH_ENABLED=false`, `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`, `VITE_SUPABASE_ANON_KEY=<publishable/anon key>`.
    **Preview scope: none of the three, or `VITE_SUPABASE_AUTH_ENABLED=false` only.** Development scope: nothing.
    These are public by design (they are compiled into the browser bundle). See section 8.
12. **The Content Security Policy.** `vercel.json` currently has `connect-src 'self'`. With accounts on, that blocks every Supabase request. This is
    a separate small PR made **after** the real project URL exists (G1). Requirements:
    - change `connect-src` to `'self' https://<project-ref>.supabase.co` (one exact https origin, no path, no wildcard, no `*.supabase.co`);
    - update `scripts/ci/vercel-headers.test.ts`, whose last test currently asserts `csp` does not match `supabase.co|supabase.in`. That assertion
      is a deliberate placeholder for "no project exists yet"; replace it with an assertion that the only Supabase origin is the Production one.
      The test above it already requires every extra `connect-src` origin to be one exact https host and rejects wildcards;
    - run `npx vitest run scripts/ci/vercel-headers.test.ts`, then the full checks, then review the PR, then deploy.
    Realtime is not used, so no `wss://` entry is needed. The CSP applies to Preview deployments too, harmlessly (they make no Supabase request).
13. **Keep the flag `false`.** **[G5]** Deploy Production (this includes the CSP PR) with accounts disabled. Check: the app loads with no console
    violations, local mode works, DevTools Network shows **no** request to `supabase.co`, and the Supabase library chunk is not downloaded.

## 4. Controlled Production smoke test (disposable accounts)

There is no staging, so the test runs against Production, with **only disposable accounts on mailboxes you control**, while registration is paused
and the public site's flag is still `false`. Use no real student data. Never create fake or sample curriculum in Production.

Some checks need published curriculum, and the real curriculum must not be published until verified. So the smoke test is in two parts.

### Part A: before curriculum exists (this is **G6**)
Done from the maintainer's machine, using the local app (`npm run dev` with `.env.local` pointing at the Production URL and key and the flag on)
after temporarily allowing the exact localhost redirect entries (section 3.4). Pre-create accounts as the dashboard allows while registration is paused,
or briefly allow registration for the disposable accounts only, then pause again.
1. **Signup** with a display name. Confirmation email arrives (check sender, SPF/DKIM pass, link is the PKCE link). Open it in the **same** browser: signed in.
   Open another link in a different browser: the "other browser" message. Try an expired link.
2. **Trigger.** `profiles` and `user_settings` rows exist for the new user, display name correct. **If signup errors, stop (section 5.3).**
3. **Login, wrong password, sign-out, password reset** end to end (the reset link is the other redirect entry).
4. **Account page:** export downloads a valid file for an account with no data (empty sections, counts zero, no credentials).
5. **Onboarding with no curriculum:** "Enrolment is not open yet" with a way back to local mode. "Start the import" is disabled with the reason.
6. **Account deletion and the `amr` claim.** Sign in with the password, then delete a *different* disposable account through the app: the typed phrase,
   the password, then the account and its rows disappear. This is the first test of `delete_my_account()` with the hosted token. A stale-sign-in
   refusal should also be seen (wait 5 minutes after signing in, then call the RPC without signing in again: expect the "fresh password" message).
   **If deletion is refused for a fresh password sign-in, the hosted token does not carry the expected `amr` entry: do not launch (section 5.7).**
7. **Local data untouched.** Check `cma-study-os`, `cma-study-os-timer` and `cma-study-os-ui` before and after: byte-for-byte unchanged.
8. Remove the temporary localhost redirect entries.

### Part B: after Group I is published (before registration opens; this is **G8**)
Needs the staged publication in section 6 to have completed Stage 2 (availability enabled, Group I). Registration is still paused, so only the
disposable accounts can enrol. Use the **production origin** (flag turned on, see G9 note below).
9. **Enrolment:** only Group I is offered; Group II is not; create the enrolment; onboarding completes; archive, make active, change groups.
10. **Sync:** log focus time and a planned session; edit name, a setting and an exam-date override; the chip says "Synced"; rows are in the database.
    Reload, offline then reconnect, and confirm "Offline (N pending)" and no duplicates.
11. **Batching:** queue a few hundred records offline (or import them), reconnect; confirm they arrive in a few requests, none duplicated. This is the
    first run of the bulk upsert on the hosted API (section 7).
12. **Import:** with local own-data on the device, run the wizard (match, preview, confirm); repeating it adds nothing; local keys unchanged.
13. **Export:** counts match the database; nothing of another user; a large account pages completely.
14. **Conflict recovery:** edit one record in two browsers; the server version wins, the loss is logged in the sync panel; Export report works. A
    database-refused edit (a date outside 2000 to 2100) is set aside and can be retried or discarded.
15. **Two tabs:** queue a change in one, sign out in the other; no local sample data reaches the outbox.
16. **Deletion** of a disposable account that has data; the curriculum and other accounts are untouched.
17. **Cross-user isolation:** account B cannot see or change account A's data.
18. Remove or delete all disposable accounts afterwards.

**The flag and Part B.** Part B needs the Production deployment (for the real origin, the CSP and the email links) with the flag on. Turning the
flag on is **Gate G9** and is allowed only while registration is paused, so the public cannot register. Sign in with pre-created disposable accounts
only. If anything fails, turn the flag back off (section 5.1).

## 5. Rollback and recovery

None of these procedures resets or overwrites a live database. For availability incidents (paused project, outage, Auth or database failure, email,
quota limits, configuration errors, sync backlog) the detailed procedures are in `production-supabase-recovery.md`; this section is the summary.

### 5.1 Disable account authentication
Set `VITE_SUPABASE_AUTH_ENABLED=false` in Vercel Production and redeploy (or promote the previous deployment). The app returns to local mode; it makes
no Supabase request. Signed-in users' per-account data stays on their device and in the database; nothing is deleted. Local-mode data is untouched.

### 5.2 Roll back a Vercel deployment
In Vercel, promote the last known-good deployment. The database is independent of the deployment; a code rollback does not roll back data. If a
migration is already applied, the previous code must still work with the new schema; migrations are additive and forward-only.

### 5.3 A failed signup trigger
**Symptom:** signup returns an error, or a user appears in Auth without a `profiles` row.
1. **Pause registration immediately** (dashboard Auth settings) and turn the flag off (5.1).
2. Check `on_auth_user_created` and `public.handle_new_user()` exist and the function is owned by `postgres` with `security definer`.
3. Look at the Postgres and Auth logs for the error (for example a missing function, a permission failure, or a constraint).
4. Users created without a profile cannot use the app (the account loads show "profile not ready"). Do **not** hand-insert rows to paper over it; fix
   the trigger through a reviewed, forward-only migration, then repair affected users one by one, reviewed.
5. Re-test with a disposable account before reopening registration.

### 5.4 A failed migration
If `db push` fails: stop, do not retry blindly, and do not assume the failed file was applied atomically (check what, if anything, it left behind). Record the error and the
migration history (`migration list --remote`). If the failed file left nothing behind, correct the cause with a new reviewed change and re-run the
dry run. **Never** edit an applied migration and **never** reset the hosted database. If objects were left half-created, diagnose them read-only
first; the remedy is a reviewed forward migration. While the project is empty (before any student exists), the maintainer may decide to delete the
whole project and recreate it; that is the only "reset" and it needs explicit approval.

### 5.5 Supabase unavailable
The app keeps working in local mode and, in account mode, from the on-device mirror: changes queue in the persistent outbox and the chip shows
"Offline (N pending)". Nothing is lost; on reconnect the queue sends itself. If the outage is long, turn the flag off (5.1) so new visits do not
wait on it. Check the Supabase status page. Do not clear browser storage to "fix" it. Details, including a paused project: `production-supabase-recovery.md`.

### 5.6 Restore a backup (into a separate recovery environment only)
Restoring over the live database is **not** part of this runbook. If data must be recovered: create a **new, separate** Supabase project, restore
the chosen backup into it, verify there (counts, a sample export), and decide with the maintainer what to copy back, using a reviewed plan. Which
backups exist and for how long depends on the actual plan (section 7); check it in the dashboard before relying on it. A logical dump is also
possible with `npx supabase@3.0.0 db dump --remote` (needs the link and Docker; read-only). Backups, their verification and restoring into a recovery target
(a fresh local stack first; a temporary separate project only with approval): `production-supabase-recovery.md` section 8. For one student's own
export there is no automatic restore: `account-export-restoration.md`.

### 5.7 Account deletion misbehaves on the hosted token
If `delete_my_account()` refuses a fresh password sign-in, the access token on the hosted project may not carry the `amr` entry the function reads
(`method = 'password'` with a recent `timestamp`). Do not launch with deletion broken. Inspect a sample token's claims (a disposable account), then
change the function through a reviewed forward migration with a pgTAP test. Do not remove the recent-authentication guard.

### 5.8 Sync backlog and set-aside records
- A student with a backlog needs nothing but a connection: the queue persists and sends in batches of up to 200 rows per request.
- **Set-aside** records are changes the server refused (or that failed 12 times). They are kept, never discarded: the sync panel offers Try again,
  Discard and Export report. Support should ask for the exported report, not for credentials.
- A growing number of refusals for one rule across users means a bug or a quota: check `get_my_quota()` behaviour and the database logs, and pause
  registration if needed.
- Never ask a student to clear site data.

### 5.9 Pause registration
Dashboard → Auth: turn off new sign-ups. Existing users keep working. Reopen after the cause is fixed and a disposable signup succeeds. The flag
(5.1) is the heavier lever and also stops sign-in.

### 5.10 Failed email delivery
Symptoms: confirmation or reset emails do not arrive. Check the SMTP provider's logs and the Auth logs, SPF/DKIM/DMARC, the sender address, the
sending limits and the templates (`{{ .ConfirmationURL }}`). Pause registration while it is broken. The app tells the student to check spam and
offers to resend. Do not switch to the shared default sender as a "temporary" fix for real students.

## 6. Curriculum: verification and staged publication

The real bundle (`supabase/curriculum/bundles/cma-intermediate-2022/`) is **entirely draft**: every record has no verifier. Verified at the time
of writing:

```bash
npm run curriculum:validate -- supabase/curriculum/bundles/cma-intermediate-2022 --shared supabase/curriculum/shared
# OK: cma-intermediate.syllabus-2022 v1 is valid (74 chapters, 45 resources)
npm run curriculum:sql -- supabase/curriculum/bundles/cma-intermediate-2022 --shared supabase/curriculum/shared --out <file-outside-the-repo>
```

**Do not run `curriculum:sql` for Production until step 22.** Do not commit the generated file. The importer's behaviour on a database is proven only
on the local stack (`test-real-bundle.sh`, `test-staged-publication.sh`).

Order (steps 21 to 24 of the launch sequence):
- **21 Human verification** [G7]: a person compares the bundle with the official ICMAI documents record by record (preferably on a different day),
  and confirms the December 2026 time table is current. Open questions from `docs/architecture/m5-curriculum-review.md` section 10 (supplementary
  material for Papers 8 and 10, model papers for Papers 5 and 9, June 2026 practice papers) are decided by the maintainer. **Nothing here is done by
  an assistant.** The first paper is on **10 December 2026**; the schedule is the maintainer's to manage, and quality of verification must not be
  traded for speed.
- **22 Import as drafts**: generate the SQL from the unchanged draft bundle, review it, take a backup, and apply it by hand. Students still see
  nothing (`csv_is_ready` is false; `enrollment_options` is empty).
- **23 Staged publication**: the reviewer sets `status`, `verifiedAt`, `verifiedBy` (their own handle) on what they checked, in a reviewed PR.
  **Stage 1:** Group I and the course, syllabus, link and attempt published, availability still draft; compare the published hierarchy with the
  golden outline (`scripts/curriculum/__fixtures__/real-bundle-outline.txt`) before going on. **Stage 2:** enable the December 2026 availability
  (Group I only is offered). **Stage 3, later, after its own review:** Group II, with no id or stable key changing. Back up before each stage.
- Part B of the smoke test (section 4) runs after Stage 2.
- **24 Open registration [G10]** only after Part A and Part B pass and the publication gates have passed: turn sign-ups on, make one disposable
  signup **on the production origin** while watching the logs (this is the first test of the email link on the real origin), and pause again at once
  if anything is wrong.

## 7. Risks and unresolved limitations (honest list)

Never verified on a hosted project:
1. **The `auth.users` trigger and `handle_new_user()`** (works against the local GoTrue; the `postgres` role's permission to create the trigger on a
   hosted project is expected, not proven).
2. **The `amr` claim** the `delete_my_account()` guard reads, in the hosted access token.
3. **Email delivery and the PKCE callback exchange** from a real link (the local stack has no mail server).
4. **Hosted PostgREST bulk upsert** (`Prefer: resolution=ignore-duplicates`), used by the batched sync and verified only on the local stack.
5. **The CSP in a real browser against the Production origin.** It was verified against the local stack's origin only.
6. **Real SMTP configuration** (provider, domain authentication, templates): not chosen in this repository.

Unknown until the project exists:
7. **Plan limits:** backup frequency and retention, point-in-time recovery, database size and egress headroom, auth email limits, and whether a
   project can pause. Free-tier headroom was not measured. Quotas in the database (for example 20,000 focus records per account) bound per-account
   growth but are not a capacity plan. Assess this against the real plan before opening registration.
8. **No staging.** Because there is no hosted rehearsal, the first hosted migration is the Production one. Mitigations: empty project, local
   proof of the same six files, dry run, backup, gates, disposable accounts.

Outstanding work:
9. **Curriculum verification is not done**, and it is human work. The December 2026 timetable is a hard external date (10 December 2026).
10. **The CSP edit is not made yet** (needs the real project URL).
11. **No restore-from-export tool exists.** The export is a documented JSON file (`account-export-restoration.md`); recovering a student's data from it
    is a manual, maintainer-approved database operation that has not been written or rehearsed. A paused-project and outage procedure exists
    (`production-supabase-recovery.md`) but is unrehearsed and its plan-dependent facts are marked for verification. A backup-restore rehearsal into a
    recovery target is still to be done.
12. Preview deployments cannot test accounts, by decision.

## 8. Vercel environment variables (the only three)

The application reads exactly these (`src/lib/supabase/config.ts`). All are **public**: they are compiled into the browser bundle.

| Variable | Value | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_AUTH_ENABLED` | `false` until G9, then `true` | Only the exact text `true` turns accounts on; unset or anything else is local mode with no network call |
| `VITE_SUPABASE_URL` | the exact Production project URL | one origin, https (plain http is accepted only for localhost) |
| `VITE_SUPABASE_ANON_KEY` | the project's anon or `sb_publishable_` key | the app **refuses** any other key, including a service-role or `sb_secret_` key |

Never in any Vercel variable, `VITE_` or otherwise, or in the repository or CI: the service-role key, an `sb_secret_` key, the database password,
or a Supabase access token. `npm run guard:secrets` (repository) and `npm run guard:secrets -- --dist dist` (build) fail on these; CI also fails if
the database job's environment holds a hosted credential. **Preview deployments must hold none of the Production values.** `VITE_AUTH_SITE_URL` no
longer exists: email links always return to the page's own origin.

## 9. Launch sequence at a glance (the 24-step order, with this runbook's sections)

| Step | Action | Where | Gate |
| --- | --- | --- | --- |
| 1 | Confirm current `main` and green CI | section 2 | G0 |
| 2 | Create the Production Supabase project | 3.1 | G1 |
| 3 | PostgreSQL 17 if available | 3.1 | |
| 4 | Administrator MFA | 3.1 | |
| 5 | Store the database password securely | 3.1 | |
| 6 | Review all six migrations | 3.2 | |
| 7 | Take and record the baseline | 3.2 | |
| 8 | Review the migration dry run | 3.2 | G2 |
| 9 | Apply the migrations by hand | 3.3 | **G3** |
| 10 | Verify schema, grants, RLS, functions, triggers | 3.3 | |
| 11 | Hosted Auth settings (registration paused) | 3.4 | G4 |
| 12 | Custom SMTP and domain authentication | 3.4 | |
| 13 | Exact production callback URLs | 3.4 | |
| 14 | Production Vercel variables (Preview has none) | 3.5 | |
| 15 | Auth flag stays `false` | 3.5 | |
| 16 | CSP PR, then deploy Production with accounts disabled | 3.5 | **G5** |
| 17 | Controlled smoke test with disposable accounts | 4 (Part A) | **G6** |
| 18 | Signup, confirmation, trigger, login, reset (Part A); enrolment, sync, batching, import, export, conflict recovery, deletion (Part B, after step 23 Stage 2) | 4 | **G8** |
| 19 | Check the hosted `amr` claim | 4 (Part A, item 6) | |
| 20 | Confirm backup and recovery readiness for the actual plan (verify retention, PITR and restore behaviour in the dashboard; take and verify a first backup; rehearse a restore into a recovery target) | 5.6, 7, `production-supabase-recovery.md` section 8 | |
| 21 | Human curriculum verification | 6 | **G7** |
| 22 | Import the reviewed curriculum as drafts | 6 | per-step approval |
| 23 | Staged publication: Group I, availability, then Group II after its own review | 6 | per-stage approval |
| (between 23 and 24) | Turn the flag on while registration is still paused, then run Part B | 4 | **G9** |
| 24 | Open public registration | 6 | **G10** |

Step 18 is split because enrolment, sync, import and deletion-with-data need published curriculum, and the real curriculum must not be published
before it is verified (step 21) and never replaced with a fake one in Production.

## 10. Final readiness checklist before opening registration

All must be true, recorded with the date and the person:
- [ ] Section 2 pre-flight passed on the deployed commit; GitHub Actions green.
- [ ] Gates G0 to G9 are recorded, and the Part A and Part B smoke tests passed with disposable accounts (disposable accounts then removed).
- [ ] The CSP contains the exact Production origin (no wildcard) and the header tests pass.
- [ ] Curriculum: verified by a person, imported as drafts, Group I published and availability enabled; Group II only after its own review.
- [ ] **Backups verified against the actual plan**: retention, frequency and PITR recorded; a first backup taken; where it is stored; a restore rehearsed into
      a recovery target (`production-supabase-recovery.md` section 8). No backup is assumed to exist because it should.
- [ ] The incident procedures are read by the maintainer: `production-supabase-recovery.md` (paused or unavailable Supabase, sync backlog, pausing
      registration, communication) and `account-export-restoration.md` (an export is not a restore).
- [ ] The maintainer knows the two levers (pause registration; turn the flag off) and where each is.
- [ ] Gate G10 approved in writing.
