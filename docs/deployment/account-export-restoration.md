# Account export: what it is, and what it cannot do (yet)

**Read this first: there is no automatic restore from an account export.** M9 can *produce* an export of a student's account data. Nothing in the
application *reads* that file back. This document records exactly what the export contains, what is and is not supported today, and a safe, manual
procedure for the case where a student has lost access to account data but still has an export. It is written against `main` at `7bbca94`. Part of
the Production recovery set: `production-launch-runbook.md` and `production-supabase-recovery.md` (same folder).

Two different things are easy to confuse. They are **not interchangeable**:

| | Account export (M9.2) | Local-mode import (M9.1) |
| --- | --- | --- |
| Direction | out of the account, to a file | from this browser's local-mode data, into the account |
| Source | the signed-in user's rows on the server | the one browser key `cma-study-os` (local mode, sample curriculum) |
| Matching | none (it is a copy) | the student matches each local chapter to a chapter of their course |
| Code | `src/lib/portability/accountExport.ts` | `src/lib/portability/importPlan.ts`, `importRun.ts`, `src/features/portability/ImportWizardPage.tsx` |

## 1. Current support

| Operation | Current support | Evidence |
| --- | --- | --- |
| Export account data to a JSON file | **Supported** | Account page, "Download my data"; `exportAccountData()` |
| Import local-mode records into an account | **Supported** through the explicit wizard, only when signed in, in account mode, with an active enrolment and the account curriculum loaded | `ImportWizardPage.tsx`; disabled with a reason otherwise |
| Restore a previously downloaded account-export JSON | **Not supported** | No code reads `cma-study-os-account-export`. The only file inputs in the app are the profile picture and the *local-mode* backup in Settings. Verified: giving an export document to the local importer's validation (`loadSnapshot`/`parseSnapshot`) is refused with "Settings are missing or invalid", and Settings' Import button is disabled in account mode |
| Restore an entire account into a different user | **Not supported** | There is no function, screen or script for it. Identity (the user id, and every key tied to it) cannot be recreated by the application |
| Restore shared curriculum from a student export | **Not supported, and never intended** | The curriculum is shared and verified separately; an export carries only labels for the records a student's data points at |
| Undo an account deletion | **Not supported** | `delete_my_account()` removes the user and, by cascade, every personal row. The export is then the only copy |

Nothing in this table should be adjusted without code that proves it.

## 2. What the export contains

Produced in the student's own browser from the signed-in user's own access (row level security); nothing is uploaded anywhere.

- **Format identifier:** `format: "cma-study-os-account-export"`.
- **Current schema version:** `schema_version: 1`. Also `exported_at` (ISO time) and `account: { user_id }`.
- **File name:** `cma-study-os-account-<yyyy-mm-dd>.json`, saved by the browser (normally its Downloads folder). No server copy is made.
- Field names are the database's own column names (`docs/architecture/database-schema.md` documents them).

| Section | Content |
| --- | --- |
| `profile` | `id`, `display_name`, `time_zone`, `onboarding_completed_at`, `created_at`, `updated_at`. **No picture** (`avatar_data_url` is not selected) |
| `settings` | the account's settings row (targets, study window, focus and break lengths, theme) |
| `enrollments` | **every** enrolment, active and archived, each with `status`, `csv_id`, `exam_attempt_id`, the student's own `exam_date_override` and `final_revision_date`, timestamps, and `group_ids` (the groups chosen) |
| `data` | `chapter_progress`, `planner_sessions`, `study_sessions` (focus time), `revisions`, `practice_records`, `mock_tests`, for **all** enrolments. Each row carries `user_id`, `enrollment_id`, `csv_id`, the curriculum id it refers to (`chapter_id` or `subject_id`), its `client_id`, its own `id` and timestamps. A focus record's link to a planned session is `planner_session_id`, the id of a row in `planner_sessions` in the same file |
| `import_history` | fingerprints and counts of explicit local imports (`local_import_runs`) |
| `references` | labels for shared curriculum records the data points at, so the ids are readable: `courses`, `syllabus_versions`, `exam_attempts`, `subject_groups`, `subjects`, `chapters` (with `stable_key`, titles, official numbering, status). **Marked in the file as not the student's data** |
| `counts` | rows per section, so a reader can check nothing is missing |

**Multiple enrolments** are represented as multiple entries in `enrollments`; every study row names its `enrollment_id`, so records stay attached to
the right enrolment.

**Curriculum references** are the shared records' database ids plus, in `references`, their `stable_key`. The stable keys are the identity that
survives curriculum updates; the ids are the identity inside one database.

**What is account-owned:** `profile`, `settings`, `enrollments`, `data`, `import_history`. **What points at shared records:** `csv_id`,
`exam_attempt_id`, `group_ids`, `chapter_id`, `subject_id`, and everything under `references`.

**Excluded, on purpose:** the picture; the email address; passwords, access and refresh tokens and any other credential; the running timer and
timer settings (device-only); anything from local mode (including the local sample data and local keys); another user's rows; the quota counters;
the whole curriculum (only referenced records appear, as labels).

**Completeness.** Every list is read page by page with explicit ranges, ordered by a stable key, so the API's row cap cannot truncate it; a failure
on any page fails the whole export rather than producing a short file. Reference lookups are chunked (100 ids). Every query also names the user
explicitly, on top of RLS. `counts` lets a reader verify the totals; a real-database test checks the counts equal the database's, including past
the API's row cap, and that nothing of another user appears.

## 3. Data safety rules for exports

- An export holds a student's study records, planner notes and focus history. Treat it as private personal data.
- **Never upload it to a public website**, a public issue tracker, a chat channel, or an AI service.
- **Never commit it to Git.** `*.json` exports must never enter this repository.
- Never share an export that contains personal notes or records, except with the student's explicit consent and only through a private channel.
- Store it somewhere private and access-controlled (an encrypted drive or a password manager's file store). Keep the original unmodified.
- The file contains no credentials and must never be edited to add any.
- **Never overwrite a live account with an export.** **Never delete local-mode data as part of a recovery.**
- The sync panel's "Export report" is a different file (conflicts, set-aside changes and pending changes, **including the record content**): the same rules apply.

## 4. Safe recovery procedure (manual, maintainer-led)

Use this only when a student has lost access to account data and still holds an export. **No step below writes anything until step 9 is approved.**

1. **Preserve the original.** Copy the file to secure storage and work only on copies. Record its SHA-256 and who supplied it, and when.
2. **Verify the format.** The top-level `format` must be exactly `cma-study-os-account-export`. Refuse anything else.
3. **Inspect `schema_version`.** Only `1` is described here. A different version needs its own review before use.
4. **Check the curriculum.** Is the same course, syllabus version and attempt still published in Production? Do the referenced `chapters[].stable_key`
   values still exist? (Ids are database-specific; stable keys are the portable identity.)
5. **List missing or retired references.** Any study row whose chapter or subject no longer exists, or is retired, needs a decision (keep as
   history, leave out). Never invent a mapping, never match by name or position.
6. **Does the original account still exist?** Look the user id up in Production.
   - *It exists and its data is intact:* nothing needs restoring. Keep the export for comparison only.
   - *It exists but some data is missing:* the missing rows are the candidates; compare by `client_id` and `id` against the export. Existing rows are never overwritten.
   - *It was deleted:* continue to step 7.
7. **A new account is a new identity.** Deleting an account removes the user; signing up again creates a **different user id**. Every row in the
   export carries the *old* `user_id` (and old enrolment ids). Re-inserting them under the new user is a **data migration**, not a restore of the
   original identity, and `client_id` uniqueness is per user, so a record that already exists in the new account (for example from a fresh import)
   would clash.
8. **Decide what needs a supported application feature.** Today that is *all of it*: there is no supported restore. Items that a future feature
   would cover are listed in section 5. Do not improvise a workaround in the browser.
9. **Require an approved, reviewed procedure before any write.** Because there is no application feature, recovery today means **manual database
   intervention by the maintainer**. That needs, all four, in writing:
   - explicit maintainer approval;
   - a fresh backup taken beforehand and verified (see `production-supabase-recovery.md`, "Backup and restore");
   - an RLS and ownership review (every restored row must belong to the intended user and enrolment, with the enrolment's `csv_id`);
   - SQL that has been **written, reviewed and rehearsed on a local stack or a separate recovery target**, never first on Production. It must respect:
     the per-user `client_id` uniqueness, the enrolment/user/syllabus foreign keys, the one-pending-revision and one-live-revision-number unique
     rules, the quota triggers (inserts count against quota), date bounds, and immutable columns.
   Do not recommend or attempt: inserting from the browser, using a privileged key from the app, or bypassing RLS from the client.
10. **Preserve existing data; avoid duplicates.** Insert only what is absent, keyed by `(user, client_id)`; do not update or delete existing rows;
    never overwrite a live account with the export.
11. **Validate afterwards.** Compare per-table counts with the export's `counts` (less anything deliberately left out, listed), check every
    relationship (planner links, enrolment, chapter belongs to the enrolment's syllabus), sample a few records with the student, and have the
    student download a fresh export and compare it with the old one.
12. **Keep an audit trail.** Record: the request, the export's hash, the decision and approver, the backup used, the exact reviewed SQL, the row
    counts before and after, the validation results and the date. Store the trail privately; it must not contain study content.

## 5. Future work (not implemented here)

A proper "restore from export" feature is future work, **not** a manual workaround to be improvised. It must at least provide:
- **schema-version validation** and refusal of unknown formats and versions;
- **identity checks** (whose export it is, whether it matches the signed-in account, no cross-user restore);
- **stable curriculum matching** by stable key, with unmatched and retired references surfaced for a decision;
- a **preview** of what would be written, with counts per category;
- **idempotency** (re-running restores nothing twice) and **partial recovery** (one refused row never costs the others);
- **ownership enforced** by the database, written only through the signed-in user's own access, never a privileged credential;
- an **explicit confirmation**, a progress and result report, and no change to local-mode data.
The M9 import wizard's planner and runner are a reasonable base to extend, but that is a new feature needing its own review.

## 6. Checking this document stays true

This document is accurate only while `src/lib/portability/accountExport.ts` still defines `schema_version` 1 and nothing reads the export format. If
a restore feature is ever added, update section 1 and 4 in the same change.
