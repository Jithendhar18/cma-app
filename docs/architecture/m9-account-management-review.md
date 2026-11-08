# M9 review — account management and data portability

Branch `feature/m9-m10-account-management-sync-performance`, based on `origin/main` at `20e9fa9` (the M7 + M8 merge). M9 is the first of two commits on this branch; M10 follows in its own commit and its own review (`m10-sync-performance-review.md`). **Nothing is pushed, merged or deployed.**

## 1. Verification before starting

- Working tree clean; `origin/main` fetched and contains M7 (`4f425bd`) and M8 (`631ce14`) via the merge `20e9fa9`.
- Read: `m7-m8-review.md`, `phase2-implementation-plan.md` (its M9 text: *import wizard, backup first, demo excluded, chapter mapping, preview, idempotent import, `local_import_runs`; account deletion*), `database-schema.md`, and the real SQL: `delete_my_account()`, `local_import_runs`, the personal tables, grants and quotas.
- **Documented scope vs this brief — discrepancies, and what I did:**
  1. The plan says "chapter mapping" without saying how. The M7/M8 rules forbid mapping the sample chapters to official ones, and the sample curriculum's ids (`p5-1`) are not account ids. So the wizard matches **only by exact id or by the student's own explicit choice** (section 3).
  2. The plan says "sign-out with outbox handling and local cleanup" and "after sign-out the per-user local keys are gone". M8 (approved) deliberately **keeps** the per-user keys on sign-out so pending changes survive. I kept M8's approved behaviour; the per-user keys are removed only after a **confirmed account deletion**.
  3. The plan says "a backup file is downloaded before any upload". The brief's wizard guarantees local data is never changed, and the account export (M9.2) is the backup of the account side. I made the backup a **recommendation, not a gate**: the wizard writes only new rows, never overwrites, and leaves local data untouched, so there is nothing to lose that a backup would restore. If you want a forced download before import, it is a one-line addition; say so.

## 2. What was built

| Part | Where |
| --- | --- |
| Reading local data (read-only, one key) | `src/lib/portability/localSource.ts` |
| Import planning (pure) | `src/lib/portability/importPlan.ts` |
| Import execution, progress, the record of a run | `src/lib/portability/importRun.ts` |
| Import wizard (4 steps) | `src/features/portability/ImportWizardPage.tsx`, route `/account/import` |
| Account export | `src/lib/portability/accountExport.ts`, `src/features/portability/ExportCard.tsx` |
| Account deletion | `src/lib/portability/deleteAccount.ts`, `src/features/portability/DeleteAccountCard.tsx`, `AccountDeletedNotice.tsx` |
| Per-account key cleanup | `clearAccountKeys` in `src/lib/account/keys.ts`; new key `cma-import-job:<userId>` |
| Account screen | `AccountPage.tsx`: three new cards (import, export, delete) |
| Types | `local_import_runs` and `delete_my_account` added to `database.types.ts` |

**No database change.** No migration, no new function, no grant. Everything uses what M3/M6/M7/M8 already provide (`local_import_runs` insert/select grants, the personal-table RLS, `delete_my_account()`).

## 3. Import wizard

### What is classified, and how
| Local data | Treatment |
| --- | --- |
| Chapter progress (status, confidence, notes, completion date) | **Importable** if not untouched sample data and the chapter is matched. Derived totals are never imported (they are rebuilt from the records). |
| Planned sessions | Importable (`missed` is stored as `upcoming`, as in M8). |
| Completed focus records | Importable. The link to a planned session is kept only if that session is part of the import; otherwise the record is imported without the link and the count is shown. |
| Revisions | Importable. |
| Practice records | Importable. |
| Mock tests | Importable; matched by **subject**. |
| Display name and preferences (targets, times, theme) | **Optional, off by default**, shown with the local values; applied through the account's own synced settings (so the usual server-wins rules apply). |
| Exam dates, "sample date" flag | Never copied. |
| Running or paused timer, timer settings | **Never** (device-local). |
| Avatar | **Never** (device-local). |
| UI state, sidebar, theme selection state | Never. |
| Anything flagged `demo`, `meta`/seed anchor, derived fields | Never; sample records are not even counted. |
| Curriculum definitions | Never; nothing is created or published. |

### Identity: nothing is matched silently
A local chapter or subject reaches an account chapter or subject in exactly two ways: its id **is** a destination id, or **the student chose the destination in a menu**. Never by position, index, order, or name — not even as a pre-selected suggestion. Because the local sample ids are not account ids, in practice every chapter starts unmatched and the student matches it.

- Unmatched records are listed with what depends on them and **block the import** until each is matched or explicitly left out.
- A retired destination chapter is refused ("retired and cannot receive new records"); a destination that is not in the course is refused.
- Two local chapters matched to one destination chapter are refused (that would silently merge two sets of progress).
- Records the database would refuse (for example 0 minutes) are listed as needing attention, not dropped.

### Preview, confirmation, execution
- Step 3 shows, per category: yours, will import, already in your account, account version kept, needs attention, left out; the destination course and attempt; and says the local data will not change.
- The import button needs an explicit tick ("I understand this saves N records…"). Nothing is written before it.
- Execution reuses the sync engine's own repository (`SupabasePersonal`): authenticated, RLS-protected, deterministic client ids (the local record ids), insert-if-absent, parents before children, chunks of 50. So:
  - **Idempotent and resumable:** a record already there with the same content counts as done; running again writes nothing twice. The wizard keeps the student's choices (`cma-import-job:<userId>`, plain counts and ids, never study content) so a resume does not start over.
  - **Server wins:** a record that exists with different content is never overwritten and is reported as "account version kept".
  - **Partial failure is visible and recoverable:** one refused record does not stop the rest; the result says "finished with problems", lists what was refused, and offers *Try again*. A paused run (offline or expired sign-in) says so and offers *Continue*.
  - **A clash with a different record** (found on the real database: the same revision number for the same chapter) is reported as **refused**, never as "kept" — it is not saved. (An early draft counted it as kept; the real-stack test caught that.)
- When a run completes with nothing refused, one row is recorded in `local_import_runs`, keyed by a SHA-256 of the **approved payload** (what was matched and not left out), so repeating the same selection is recognised ("already imported on …") and a different selection is not blocked. Partial runs are not recorded as done.
- After a completed import the engine is asked to pull, so the imported records appear in the account's own screens.
- Local data is never rewritten: the wizard reads exactly one key, read-only (tested: no `setItem`, no `removeItem`, one `getItem`), and the timer is never touched.

### Eligibility, including today's state
The wizard needs: signed in, account mode, an active enrolment, the account curriculum loaded and the stores bound to it. While enrolment is not open (the real, draft-only curriculum), the Account page shows **"Start the import" disabled with the reason** and the wizard cannot be reached. Nothing is fabricated to get around publication.

## 4. Account export
- One JSON file, format `cma-study-os-account-export`, `schema_version` 1, `exported_at`. Sections: `profile` (name, time zone; **no avatar**), `settings`, `enrollments` (active and archived, each with `group_ids`, and the student's date overrides), `data` (chapter progress, planned sessions, study sessions, revisions, practice records, mock tests, for every enrolment), `import_history`, `references` (labels for the shared curriculum records the data points at, clearly marked as not the user's data), and `counts` so a reader can check nothing is missing. Fields keep the database column names, so `database-schema.md` documents the structure.
- Read-only, through the signed-in user's access (RLS), and every query also names the user. Every list is read page by page; a failure on any page fails the export (it never produces a silently short file). No credential or token can appear (tested).
- States: working, success with the counts, and plain errors (network, signed out, other), each saying nothing was downloaded.

## 5. Account deletion
- Contract of the existing function, read from the SQL: `delete_my_account()` is `security definer`, uses `auth.uid()`, and refuses unless the JWT shows a **password** sign-in within the last **5 minutes** (error `P0401`, hint `REAUTHENTICATE`); then it deletes the auth user, and every personal row goes by cascade; shared curriculum is untouched.
- Flow: warning text; recommendation to export first (a button in the dialog); the exact phrase `DELETE MY ACCOUNT`; the password. Only then: (1) a **fresh password sign-in** through the normal auth service, so the server itself verifies the password and the guard has a fresh proof; (2) the `delete_my_account` RPC. No admin API, no direct table delete, no privileged key.
- A wrong password, a stale sign-in, a network failure, an expired session or any server refusal → a plain message and **"Nothing was deleted"**; the user stays signed in; no success is ever shown from anything but the server's answer.
- On the server's confirmation only: sign out through the normal path (the app returns to local mode), remove **only that account's** browser keys (`clearAccountKeys`: every key ending in `:<thatUserId>` plus its sync lease; it refuses a malformed id, never matches the three local-mode keys, and never touches another account's keys), and show "Your account was deleted" on the screen the student lands on.
- The button is never one click: it does not exist until the dialog is open, and is disabled until the phrase matches exactly and a password is entered.

## 6. UX and accessibility
Existing design system (Card, Sheet, Button, Notice, field styles). The wizard has a visible step list with `aria-current`, focuses the step heading on each step, labels every control, uses real tables with captions and column/row headers, announces progress and results politely, and has loading, empty, success, partial-success, paused and error states. The deletion dialog focuses the first field. Layouts wrap on a phone width; tables scroll inside their card.

## 7. Security and RLS summary
- No privileged credential anywhere; the secret guard passes on the repository and the build.
- Import, export and deletion use only the browser's authenticated, user-scoped access. Imports are checked against RLS on the real database: another user cannot import into this user's enrolment (nothing written).
- Import writes only to the six personal tables and `local_import_runs`, all existing grants. No account data is written to a local key; no local key is changed (byte-for-byte tests, in the unit suite and in the app-level flow).
- The one browser key added, `cma-import-job:<userId>`, holds the student's matching choices (ids) and plain counts.
- Real two-tab protection from M8 is unchanged and still passes, with both mutations detected.

## 8. Tests and results
| Suite | Result |
| --- | --- |
| Vitest (whole project) | 880 passed, 48 skipped (opt-in real-stack suites) |
| New unit/app tests | planner 18 · runner, local storage and run records 14 · export 13 · deletion and key cleanup 9 · app-level wizard/export/delete flows 13 (67 in all) |
| Enrolment + sync + portability integration (real local stack) | 29 passed (23 earlier + 6 new, see below) |
| Auth integration | 19 passed |
| Two real browser pages | passes; both mutations detected |
| Typecheck, ESLint, build | 0 errors, 0 problems, succeeds |
| Secret guard | repository and `dist/` clean |

Real-stack scenarios added: **24** import once, idempotently, with the planned-session link, chapter progress and the recorded run (the same approved data cannot be recorded twice); **25** an account record that differs is not overwritten, a refused record does not stop the others; **25b** a clash with a different existing record is refused, not reported as kept; **26** another user cannot import into this user's enrolment; **27** export equals the database counts for every table, past the API row cap (more than 2,500 rows), contains nothing of another user and no credential; **28** deletion: wrong phrase and wrong password delete nothing, the correct password deletes the account and its rows, the curriculum and other accounts are untouched.

Existing assertions changed: one. `screens.test.tsx`'s "offers no account deletion, import, upload or sync control (…later milestones)" described a page without these features. It is replaced by a stronger check: the three entry controls exist, but there is **no one-click delete** (the destructive button does not exist until the dialog is opened), no file upload, no sync button. The M6/M7 narrowed assertions you accepted are unchanged.

Also changed, test-only: `fakeBackend` gained column projection on `select`, the import-run table, a guarded `delete_my_account`, a password check for re-authentication, and atomic row rejection; seed timestamps are proper ISO dates (a text placeholder sorted after real timestamps and hid new rows from the incremental pull).

## 9. Known limitations
- **Matching is manual.** That is the safe reading of "never map by position or similarity", but a student with many chapters of local data makes many choices. A future "load an account export" path would match by stable ids automatically.
- **Same local id in two enrolments.** `client_id` is unique per user, not per enrolment, so a record imported into one enrolment cannot be imported into another (it would be reported as clashing). Matching the schema; not changed.
- **Quota.** An import that would exceed a per-account row limit is refused record by record with the plain quota message.
- The deletion confirmation notice lives in session storage of the tab and is shown once.
- The real-stack stale-sign-in case for deletion (a session older than 5 minutes) cannot be produced on demand; it is covered by the existing pgTAP test of the guard and by a unit test with a stale proof.

## 10. Deferred
Bulk-request sync (M10), a forced pre-import backup download (if wanted), automatic matching from an account export, and restoring an export.

## 11. Manual action
None. No hosted action, no migration, no environment change.
