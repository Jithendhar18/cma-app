# Production Supabase: paused, unavailable and degraded states

The operational reference for incidents with our **single** Production Supabase project. There is no second hosted environment; the local stack
and CI are the only other places anything can be rehearsed. Part of the Production set: `production-launch-runbook.md` (setup, approval gates,
rollback) and `account-export-restoration.md` (what an account export can and cannot do).

**Status: written before the project exists.** Nothing here has been exercised against a hosted project. Dashboard section names and **plan-dependent
behaviour** (marked **[verify]**) must be confirmed by the maintainer in the actual dashboard and the current official Supabase documentation. Where
this document says "verify", it is deliberately not asserting a capability.

## 0. Rules for every incident

1. **Look before acting.** Read-only checks first (dashboard, status page, logs). Change nothing until you know which scenario this is.
2. **Do not restore a backup over the live database as an initial response.** Recovery into a separate target is section 8.
3. **Do not reset the hosted database, delete the project, or re-run migrations "to fix it".** Migrations are forward-only and applied only with
   maintainer approval, after a backup (`production-launch-runbook.md` section 3).
4. **Never ask a student to clear browser storage, sign out to "reset" the app, or copy anything between browser storage keys.** Their unsent
   changes live there (section 3).
5. **Do not put a service-role or secret key, the database password or an access token in the app, Vercel variables, chat or tickets.**
6. Production-changing actions (pausing registration is the exception, being safe and reversible) need the maintainer.
7. Declare an incident resolved only after the verification steps for it pass, not when a status page turns green.

Tools and where to look (**names can change; verify in the dashboard**):
- **Supabase dashboard:** the project's home/status banner; Project Settings (General: pause/restore, plan); Database (Backups, and for PITR,
  whatever the plan offers); Auth (Users, sign-in and URL configuration, SMTP, rate limits, the sign-up control); Logs (API, Postgres, Auth);
  Reports/usage (database size, egress, API and auth email counts); Billing/usage for plan limits.
- **Supabase status page:** the official status page for the Supabase platform (linked from the dashboard; verify the address).
- **Vercel dashboard:** Project → Deployments (status, build logs, promote/rollback); Settings → Environment Variables; runtime logs.
- **CLI (maintainer, read-only unless stated):** `npx supabase@3.0.0 migration list --remote`, `db lint --remote --schema public --level warning`,
  `db dump --remote --dry-run`. These need `supabase link` and so are themselves hosted access: maintainer only.

## 1. What a student sees (from the code)

| What they see | Meaning |
| --- | --- |
| Header chip **Synced** | nothing waiting; last request succeeded |
| **Syncing…** | changes are being sent, or are waiting for a retry delay |
| **Offline (N pending)** | the device cannot reach the server (or the browser reports offline); N changes are safe in the on-device queue |
| **Needs attention** | something was refused or could not be loaded, or sending is paused; open the chip for details |
| Banner "You are offline. N changes are saved on this device and will be sent when you reconnect." | the same, spelled out |
| Banner "Saving is paused because your sign-in needs renewing. Your changes are safe on this device." | the access token could not be refreshed (Auth problem or expired session) |
| Banner "Some changes could not be saved to your account." | the server refused them, or they failed 12 times; they are set aside, not lost |
| Screen "Could not load your account" with **Try again** and **Use local mode instead** | the enrolment or profile could not be read |
| Screen "Could not check your session" | the sign-in service could not be reached |
| "Could not load your latest data. Showing what is saved on this device." | the first load failed; the on-device copy is shown unchanged |
| "Accounts are not set up" (configuration screen) | the flag is on but the URL or key is missing or not a public key |
| Warning "Your browser could not save recent changes (storage may be full or blocked)" | browser storage is full or blocked; export from Settings |

**Local mode is unaffected by any Supabase problem.** It makes no Supabase request.

## 2. Scenarios

Each: symptoms; where to verify; safe first response; do not; recovery verification; registration.

### 2.1 Project paused (plan or inactivity)
- **Symptoms:** every Supabase request fails or times out at once; the dashboard shows the project as paused; the status page shows no incident.
  Students see Offline / "Could not load your account".
- **Verify:** dashboard project status; section 4 (how to tell paused from an outage).
- **Respond:** section 4. Pause registration (section 6) and keep the app available in local mode.
- **Do not:** assume the data is gone; delete or recreate the project; restore a backup over it; ask students to clear storage.
- **Verify recovery:** section 4 items 5 to 10.
- **Registration:** reopen only after the verification list passes and a disposable signup succeeds.

### 2.2 Supabase unavailable (platform outage)
- **Symptoms:** requests fail or return 5xx; the project is **not** shown as paused; the official status page may show an incident.
- **Verify:** the status page; dashboard logs and reports; try a trivial read as a disposable account.
- **Respond:** pause registration; leave the app up; post a short notice (section 7); wait. The app keeps working from the on-device copy and queues changes.
- **Do not:** redeploy, change variables, rotate keys or re-run migrations hoping to help; they cannot fix a platform outage.
- **Verify recovery:** section 4 items 5 to 10, plus the first syncs (item 10).
- **Registration:** reopen after verification.

### 2.3 Database reachable, Auth unavailable
- **Symptoms:** sign-in, signup, reset and token refresh fail ("Could not reach the server" or a 5xx); the database dashboard works.
- **What the code does:** students who are already signed in keep working until their access token expires (JWT expiry is 3600 s by the local
  configuration; **verify the hosted value**). When a request then returns 401 the app refreshes the session once; if that fails, sending **pauses**
  with the "sign-in needs renewing" banner and keeps every change on the device.
- **Verify:** Auth logs; try a disposable sign-in; Auth section of the dashboard.
- **Respond:** pause registration; do not touch the database; wait for Auth. Do not tell students to sign out (it does not delete their queue, but
  they could not sign back in until Auth returns).
- **Verify recovery:** a disposable sign-in works; an existing session refreshes; the banner clears and the queue drains.
- **Registration:** after a disposable signup succeeds, including the confirmation email.

### 2.4 Auth works, database operations fail
- **Symptoms:** sign-in succeeds, then "Could not load your account"; sync shows Offline or Needs attention; reads or writes return errors or time out.
- **Verify:** Postgres and API logs; database reports (CPU, connections, storage); whether a migration recently ran.
- **Respond:** pause registration; if the app is stuck for new visits, consider turning the flag off (`production-launch-runbook.md` 5.1), understanding that
  it hides account mode until it is turned back on (the per-account copy and queue stay on the device).
- **Do not:** run ad-hoc DDL, disable RLS, grant privileges "temporarily", or use a privileged key to "get around" the failure.
- **Verify recovery:** section 4 items 5 to 9.
- **Registration:** after verification.

### 2.5 Email delivery unavailable
- **Symptoms:** confirmation or reset emails do not arrive; sign-up works but nobody can confirm.
- **Verify:** the SMTP provider's dashboard and logs; Auth logs; the sender domain's SPF, DKIM and DMARC; Auth rate limits and the provider's sending limits.
- **Respond:** pause registration; tell affected students to wait and **not** create more accounts (it burns the sending limit and creates unconfirmed
  duplicates). Do not switch real students to a shared default sender as a stop-gap (low limits **[verify]**).
- **Verify recovery:** a disposable signup receives the confirmation in the same browser; a reset email arrives; the links use the exact production origin.
- **Registration:** reopen only after both emails work.

### 2.6 Storage or quota limits reached
Two different limits; do not confuse them.
- **Supabase plan limits** (database size, egress, auth email, connections; **plan-dependent, verify**). *Symptoms:* writes failing, throttling or a
  warning from Supabase. *Verify:* Reports/usage and billing. *Respond:* pause registration; ask the maintainer to review usage and the plan before
  anything else; do not delete student data to free space. *Verify recovery:* usage below the limit, a disposable write succeeds.
- **Per-account row quotas** (in the database, for example 20,000 focus records). *Symptoms:* a student's changes are set aside with "Your account has
  reached its limit for this kind of record." *Respond:* this is by design; the changes are kept and can be exported; the limit is changed only by a
  reviewed migration (`quota_limits`). Do not edit quota rows by hand.
- *Registration:* reopen only after plan headroom is understood.

### 2.7 Connection or API key configuration errors
- **Symptoms:** "Accounts are not set up" (missing or non-public key, bad URL); requests fail with an invalid-key response; everything fails at once
  after a variable change or key rotation; or the browser console shows a **Content-Security-Policy** violation for `connect-src` (these look like
  "offline" to students).
- **Verify:** Vercel → Environment Variables for Production: the three `VITE_` values; the dashboard's API key page for the current public key;
  `vercel.json`'s `connect-src` (it must contain the **exact** Production origin; no wildcard); the browser console.
- **Respond:** if a recent deployment or variable change caused it, promote the previous deployment (5.2) or restore the previous value; if the CSP
  lacks the origin, fix it by a reviewed PR (`production-launch-runbook.md` 3.5).
- **Do not:** paste a service-role or secret key to make it work (the app refuses it anyway), add a wildcard origin, or disable the CSP.
- **Verify recovery:** a disposable sign-in succeeds on the production origin with a clean console.

### 2.8 Vercel available, Supabase unavailable
- The static app keeps loading. Local mode works fully. Signed-in students work from the on-device copy and queue changes.
- **Respond:** nothing to deploy. Pause registration. Do not flip the flag unless new visits are being harmed; turning it off hides account mode (data
  and queue stay on the device and resume when it is back on).
- **Verify recovery:** as the underlying Supabase scenario.

### 2.9 Vercel deployment failure (Supabase fine)
- **Symptoms:** a failed build, a broken page, or a bad release; Supabase is healthy.
- **Verify:** Vercel Deployments and build logs.
- **Respond:** the previous good deployment keeps serving until a new one is promoted; if a bad one is live, promote the last known-good deployment. Do not
  touch Supabase for a frontend failure.
- **Verify recovery:** the production origin loads, local mode works, a disposable sign-in works (flag on), the chip reaches Synced.

### 2.10 Sync queue growing during an outage
- **Symptoms:** many students show "Offline (N pending)" with growing N; the browser storage warning appears for a heavy user.
- **Respond:** nothing to fix on the server beyond restoring availability; the queue is designed to wait. Tell students (section 7) to keep the app and
  browser data, and to leave the tab or reopen it once the service is back.
- **After recovery:** queues drain themselves (section 3). Watch for a burst of requests: new rows go in bulk requests of up to 200, and a busy or
  rate-limited server is retried with backoff.
- **Do not:** ask students to clear data, to sign out and back in "to refresh", or to re-import local data. Re-importing is not a repair.
- **Verify recovery:** the logs show the first syncs succeeding; the number of pending changes falls; conflicts and set-aside counts are as
  expected (section 3).

## 3. Sync behaviour during an outage (taken from the code)

The sync engine (`src/lib/sync/engine.ts`, `errors.ts`, `outbox.ts`, `supabasePersonal.ts`) is built so an outage loses nothing:

- **Changes are saved on the device first**, in a persistent per-user queue (`cma-sync-outbox:<userId>`), with the account's on-device copy
  (`cma-study-os:<userId>`), the conflict log (`cma-sync-conflicts:<userId>`), the set-aside list (`cma-sync-deadletter:<userId>`) and sync
  metadata (`cma-sync-meta:<userId>`). A change is removed from the queue only after the server confirms it. **Clearing browser storage deletes
  these**, so it must never be suggested.
- **Offline is not an error.** A network failure or a browser-reported offline state keeps every change and is **not** counted as an attempt, however
  long it lasts. The chip shows "Offline (N pending)".
- **Retries resume by themselves:** about 400 ms after a change; when the browser comes back online or the tab becomes visible again; every 60 s
  while the app is open (pull, then send); and on "Sync now".
- **Transient server trouble** (server errors, rate limiting, timeouts) is retried with a growing delay: 2 s, doubling, capped at 5 minutes, with
  ±25% random jitter. After **12** failed attempts for a change it is set aside (kept, with a plain reason), not dropped.
- **An expired sign-in:** the session is refreshed once; if that fails, sending **pauses** and the changes stay on the device.
- **A refused change** (a rule, a per-account limit, a permission) is set aside immediately and kept: the sync panel offers **Try again**,
  **Discard** and **Export report**. Nothing is discarded silently.
- **Conflicts:** the server wins; the losing version is recorded (up to 200 are kept) and shown in the sync panel; the student can dismiss it.
- **A change from another tab** is picked up, not overwritten (the queue is re-read before every write); one tab sends at a time (Web Locks, with an
  expiring storage lease where Web Locks do not exist).
- **Sending is in batches** of up to 200 changes; new rows go in a single bulk request per run, edits and deletes individually.
- **Signing out with unsent changes** asks first; "Sign out anyway" keeps the queue on the device, and it resumes at the next sign-in.
  Account deletion is the only thing that clears these keys (after the server confirms).
- **Local-mode data must never be copied by hand into account keys.** The two worlds are separate on purpose; the only bridge is the explicit
  import wizard, which writes through the server with the student's matching choices.

**When a student should export the report:** when the chip says "Needs attention" and the panel shows set-aside or repeated problems. **The report
contains the record content** (conflicts, set-aside rows and pending rows): ask for it only through a private channel and treat it like an account
export (`account-export-restoration.md`, section 3).

**When to stop retrying and escalate:** "Sync now" is safe to press, but if two or three presses give the same "Needs attention" message, stop
pressing it, keep the app and browser data, export the report and escalate to the maintainer. Repeated presses will not change a refusal.

## 4. Paused project: how to recognise it and recover

1. **Is it paused or an outage?** In the dashboard, the project page shows its state. A **paused** project is shown as paused with a restore/resume
   control, and the status page shows no platform incident. An **outage** shows the project as active, requests failing intermittently or all at
   once, and usually an incident on the status page. Compare both before acting.
2. **Check the dashboard and the official status page.** Record the time, what each shows, and any messages.
3. **Is resuming possible on the current plan?** **[verify]** Pausing rules, how long a paused project can be restored, and whether a paused
   project's data is retained are plan-dependent and can change. Read the current official documentation and the message in the dashboard. **Do not
   assume the data is preserved indefinitely, and do not assume a project can always be resumed without intervention.**
4. **If an upgrade or manual resume is needed:** it is a maintainer decision (billing, ownership). Do it in the dashboard, record who did it and when,
   and do not create a new project as a "workaround"; a new project is a different database with none of the students' accounts.
5. **Database connectivity:** a disposable sign-in works; the dashboard's SQL editor runs `select 1`; `npx supabase@3.0.0 migration list --remote`
   shows the six migrations (maintainer, read-only).
6. **Auth and sessions:** a disposable sign-in and sign-out work; an existing signed-in browser refreshes its session and returns to "Synced"
   (or shows the "sign-in needs renewing" banner, which clears after a sign-in); an email arrives for a reset.
7. **Triggers, RLS, views and RPCs** (read-only SQL in the SQL editor):
   ```sql
   -- RLS on in public
   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
   -- the signup trigger
   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
   -- the functions and views the app calls
   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1;
   select viewname from pg_views where schemaname = 'public' order by 1;
   ```
   Expect every public table with RLS on, `on_auth_user_created`, the `public` functions named in `supabase/README.md` (26 at the audited commit), and the views `chapter_stats`,
   `daily_study_minutes` and `enrollment_options`. Then, with a disposable account: the enrolment functions respond, a user cannot read another
   user's rows, and (after publication) `enrollment_options` returns the expected options.
8. **Data integrity:** per-table row counts against the last verified backup or dump and against expectation; no table unexpectedly empty; a sample
   disposable account's export matches its data.
9. **Pending sync operations:** ask a few students (or use a disposable account) to open the chip; the number pending should fall to 0 and the
   status return to Synced. Open the panel's details for the counts. Watch for a rise in set-aside changes (a sign of a rule, quota or schema
   problem).
10. **First successful syncs:** in the API and Postgres logs, watch for the first bulk inserts and conditional updates succeeding, no unusual
    error rate, and the request count settling. Keep registration paused until this looks normal.

## 5. Reopening registration (conditions)

Reopen only when all are true: the cause is understood; the verification for that scenario passed; a **disposable** signup received its
confirmation email on the production origin and signed in; a disposable sign-in, a sync and a reset worked; logs show a normal error rate; and the
maintainer has approved. Reopen, watch the logs for the first real signups, and pause again at once if anything looks wrong.

## 6. Pausing registration

Dashboard → Auth: turn off new sign-ups (the control name may differ; **verify**). Existing users keep working. This is safe and reversible and can
be done by the maintainer at any time during an incident. The flag (`VITE_SUPABASE_AUTH_ENABLED=false` and a redeploy) is the heavier lever: it also
stops sign-in and hides account mode (data and queue stay on the device).

## 7. Communicating during an incident

Short, factual, and only what is verified. Keep the app available in local mode where safe.

- **Starting:** "We are having trouble with account sign-in and sync. The app still works on your device. Please keep using it as normal. Changes
  you make are saved on your device and will be sent when the service is back."
- **Do not** ask students to clear site data or cookies, to sign out and in, to reinstall, or to create another account. Say plainly that **pending
  changes are preserved on the device** and that creating more accounts does not help.
- **If a student's changes are set aside:** "They are safe. Open the sync indicator and use Export report, and send it to us privately."
- **Resolved:** say so only after the verification for the scenario has passed, and say what was affected and what, if anything, a student should
  check (for example, open the sync indicator and confirm it says Synced).

## 8. Backups and restore

**Do not claim a backup exists until it has been configured, taken and verified.** What exists depends on the Production plan **[verify all]**.

**Check what is available (dashboard, Database → Backups and Billing):**
- whether scheduled backups exist, how often, and **how long they are retained**;
- whether **point-in-time recovery** is available (it is typically a plan feature or add-on) and its window;
- whether a backup can be downloaded, or only restored inside Supabase;
- who can trigger a restore, and what a restore does to the *live* project (read the dashboard's own warning; many restores overwrite the project).
Record the answers (with the date) in the launch records.

**Manual logical export (maintainer, needs `supabase link` and Docker; read-only against the project):**
```bash
npx supabase@3.0.0 db dump --remote --dry-run                       # prints the pg_dump script; changes nothing
npx supabase@3.0.0 db dump --remote -f <file-outside-the-repo>.sql  # schema and (by default) public objects
npx supabase@3.0.0 db dump --remote --data-only -f <file-outside-the-repo>-data.sql
```
**Verify what a dump contains before relying on it.** Student identities live in the Auth schema (`auth.users`). A dump of `public` alone cannot
recreate logins, and `public` rows refer to `auth.users`. Check whether your dump includes the Auth data you need; if not, a restore is incomplete
by design. Do not commit dumps to Git.

**Store securely:** an encrypted, access-controlled location, not the repository, chat or a shared drive. They contain every student's study
records and notes. Record where each is, when taken, by whom, and its SHA-256.

**Verify completeness:** compare per-table row counts with Production at the time of the dump (record them first); confirm the six migrations
are represented; confirm the dump restores without errors in a target (below); spot-check a disposable account.

**Restore only into a separate recovery target**, never first over the live database:
1. Prepare a target that is **not** Production: a fresh local stack (`npx supabase@3.0.0 start`, `db reset`), which needs no approval, or, only if the
   local stack cannot hold the data, a **temporary** separate recovery project created with the maintainer's approval for this one purpose and
   deleted after verification. It is never a staging environment and never receives traffic.
2. Load the dump there. Because `public` data refers to `auth.users`, the recovery target needs the matching Auth data or a reviewed way of
   loading `public` without it; this has **not** been rehearsed, so rehearse it locally first.
3. Verify there: row counts, relationships, a sample account's export against the student's own export, and that the signup trigger, RLS and RPCs
   behave (section 4 item 7).
4. Only then consider, with explicit maintainer approval and a written, reviewed plan, whether and how anything is copied back to Production. The
   default answer is to copy back **only what is missing, row by row, under the owning user**, never to overwrite the live database.

For restoring *one student's* data from *their own export* (no backup), see `account-export-restoration.md`: there is no automatic restore.

## 9. What is not covered, and who decides

- Nothing here has been run against a hosted project. Treat each verification step as the first run.
- Plan-dependent facts marked **[verify]** are the maintainer's to confirm against the live dashboard and current Supabase documentation.
- This document does not choose an SMTP provider, a sending domain, a plan or a retention policy; those are maintainer decisions.
- A real restore-from-backup rehearsal into a recovery target is still to be done and recorded.
