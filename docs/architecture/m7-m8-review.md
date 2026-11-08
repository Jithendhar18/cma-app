# M7 + M8 review — curriculum, enrolment, personal data and synchronisation

Branch `feature/m7-m8-curriculum-sync` (from `main` at `a681568`, the M6 merge). **Nothing is committed, pushed, merged, published or deployed.**
Two stages, one review: M7 (curriculum provider and enrolment) is complete and was green before M8 started. M8 (personal repositories and the
sync engine) builds on it. If approved, this lands as two commits (M7, M8) in one pull request.

**Status: approved with two final requirements, both implemented (sections 13 and 14). Decisions are recorded in section 10.**

---

## 1. Outcome at a glance

| Question | Answer |
| --- | --- |
| Does local mode behave exactly as before? | Yes. The sample curriculum, demo data, stores, action names, selectors and the three `localStorage` keys are unchanged. The original local-mode suite passes **unmodified**, except two assertions in the M6 auth tests that were deliberately narrowed (section 8). |
| Is anything uploaded from local mode? | No. Signing in, signing out, switching mode or enrolment never uploads, merges, maps or deletes local data. Tested, including a regression for a bug I found and fixed (section 6). |
| What does the real app show today? | **"Enrolment is not open yet. Verified course options are not currently available."** with a return-to-local button. The M5 curriculum is still entirely draft, so `enrollment_options` is empty. |
| Did the M5 data change? | No. Bundle, statuses, verifiers and availability are untouched. Published scenarios use the fake fixture and rolled-back (or removed) local-database data only. |
| New database schema? | **None.** No migration was added. |
| Hosted Supabase contact? | **None.** Every database and API command refuses a non-local host. |
| Secrets? | No service-role key anywhere in the frontend, CI or browser environment. Secret guard passes on the repo (297 files) and the built bundle (341 files). |

Final numbers (all run on this branch):

| Check | Result |
| --- | --- |
| Vitest | **813 passed**, 42 skipped (the skipped ones are the opt-in real-stack suites: auth 19, sync 23) |
| Auth integration (real local stack) | 19 passed |
| **Enrolment + sync integration (real local stack)** | **23 passed** (18 original + 5 for name, settings and dates) |
| **Two real browser pages, sign-out (real local stack)** | **passes; fails when either protection is removed** (section 14) |
| pgTAP | 789 passed (20 files) |
| Schema lint (`supabase db lint`) | no errors |
| Importer / real bundle / staged publication / committed behaviour | all pass |
| Curriculum importer unit tests | 121 passed |
| Typecheck (app + scripts configs) | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Build | succeeds |
| Secret guard | repo and `dist/` clean |

New tests: 234 in the default suite (library, repository, engine, UI, parity, settings sync) plus 23 real-stack scenarios and the two-browser-page scenario.

---

## 2. M7 — curriculum provider and enrolment

### Curriculum provider
- `CurriculumRepository` (`listEnrollmentOptions`, `loadCurriculum`, `listResources`) with two implementations: `BundledCurriculum` (local mode, the existing sample data re-expressed as a tree) and `SupabaseCurriculum`.
- `CurriculumProvider` / `useCurriculum()` gives every screen subjects, groups, chapters, lookups, slugs and group names, an identity, and loading / error / retry.
- Account curriculum is read **published and retired only** (`status in ('published','retired')`, never drafts), always filtered to the syllabus, with explicit `.range()` paging (page size 1,000) so the API row cap can never truncate a result.
- Every row is validated: a draft, a dangling reference or a malformed row is refused and reported, never shown. Order is the official order. IDs are database UUIDs for account data and slugs only in routes.
- Cache: validated, long-lived, keyed by syllabus **and** a content fingerprint. A cached tree renders at once and revalidates in the background. With no cache and a failed load the app shows an error with **Retry** — it never falls back to the sample curriculum.
- 16 non-test files stop importing the hardcoded `SUBJECTS`; four local-only modules keep it on purpose (`seed.ts`, `legacyMigration.ts`, `seedValidation.ts`, `subjects.ts`). Pure libraries default to the bundled subjects so unmodified tests still pass.

### Enrolment
- Options come **only** from the `enrollment_options` view. Four cascading controls: course → syllabus → attempt → groups (any non-empty subset, so Group I only, Group II only, or both). Changing an upstream choice resets everything below it; a sole option is selected for you but still shown; an unannounced exam date is shown as "not announced", never invented.
- Writes use only the five database functions (`create_enrollment`, `change_enrollment_attempt`, `set_enrollment_groups`, `archive_enrollment`, `activate_enrollment`). There is no direct insert anywhere, and the database remains the authority (refusals are reported, not bypassed).
- Onboarding creates the enrolment, **then** marks `profiles.onboarding_completed_at`. If the second step fails, the next load finds the active enrolment and completes it: no duplicate, nothing stuck.
- Settings has an Enrolment section: course, syllabus, attempt, exam date, groups, status, past enrolments; change attempt, change groups, archive, make active, start another course. Each asks for confirmation in plain language. A running timer blocks switching (and, from M8, so do unsaved changes).

### Keeping the two worlds apart
- Account mode reuses the same Zustand stores so no screen, selector or action changes, but persistence is **swapped** to per-user keys (`cma-study-os:<userId>` and friends). While in account mode nothing writes to `cma-study-os`, `cma-study-os-timer` or `cma-study-os-ui`. Returning to local mode restores the local snapshot **without writing it**, so even a corrupt local entry is left byte-for-byte as it was.
- A gate holds a skeleton until the stores are bound to this user and this enrolment. A mirror recorded for another enrolment or syllabus is never reused.

---

## 3. M8 — personal data and synchronisation

### Shape of the design
```
store snapshot ──snapshotToEntities──▶ entities ──diff──▶ Outbox (on disk) ──push──▶ SupabasePersonal ──▶ PostgREST + RLS
      ▲                                                                                  │
      └────────────entitiesToSnapshot◀──── pullAll / pullChanges / pullIds ◀─────────────┘
```
- **Entities** are one per personal-table row, in a client form with no server id, owner or enrolment (those are stamped from the scope at the network edge, so a row can never be moved to another user or enrolment).
- **Mappers** are pure and typed. Golden test: `entitiesToSnapshot(snapshotToEntities(x)) == x`, and a second round trip changes nothing.
- **Not synced, on purpose:** demo flags and `meta`; derived chapter totals (hours, questions, correct, last studied — rebuilt from the records, mirroring the `chapter_stats` view); settings, profile and enrolment (their own owners); the avatar (stays on the device); the timer (device-local).
- **Outbox** (`cma-sync-outbox:<userId>`): one op per entity (coalescing — repeated edits fold into one, create-then-delete leaves nothing, an edit of a known row becomes an update on the version it was based on). Ordered parents-first (planned session before its focus record), deletes children-first, batches of at most 200. Persisted on every change; another tab's writes are picked up before this one writes, so tabs never overwrite each other's queue.
- **Writes are idempotent.** Inserts use deterministic client ids; a retry whose first answer was lost finds the row, sees the same content, and counts as done. Updates and deletes are conditional on the `updated_at` the edit was based on.
- **Conflict policy (D5): the server wins, never silently.** The losing change goes to a persistent per-user log (`cma-sync-conflicts:<userId>`) with both versions, shown in the sync panel in plain words, dismissable, and exportable. A row deleted elsewhere is removed here and logged, not resurrected. A stale delete does not delete a row that changed elsewhere.
- **Failures are typed.** Offline: keep everything, wait, and *never* count it as an attempt. Transient (5xx, 429, timeouts): exponential backoff with jitter (about 2 s growing to 5 min); after 12 attempts the change is set aside. Auth (401): refresh the session once, then **pause** instead of hammering the server. Quota and constraint violations: set aside immediately (they can never succeed as written) with a plain message. Malformed server rows are skipped and reported, never half-shown.
- **Staying in step.** Hydration pulls everything (paged), keeps every pending change on top of it, and captures edits made while the load was in flight. Incremental pulls (every 60 s, on focus, on reconnect) never overwrite a row that has a pending change; a 30-minute ID reconciliation notices rows deleted elsewhere. A failed hydration leaves the mirror exactly as it was and does not treat it as a change.
- **Several tabs.** Web Locks, with a short expiring storage lease as the fallback. Only one tab sends; the others pick up the result. Sign-out in one tab reaches the others through the existing auth events (M6), which unbind the stores and stop the engine; that path is covered by the unbinding tests but there is no two-browser-tab test.
- **Guards.** Changing enrolment flushes first and is blocked, with a plain message, if changes could not be saved. Signing out flushes first; if it cannot, it asks ("Stay signed in" / "Sign out anyway") and says the changes stay on this device. Sign-out never deletes account storage or touches local keys.
- **UI.** A chip in the header — *Synced / Syncing… / Offline (N pending) / Needs attention* — opens a panel with the conflict log, set-aside changes (Try again / Discard), "Sync now" and "Export report". A banner appears only when something needs the student. The chip and banner do not exist in local mode.

---

## 4. How the requirements are met

| Requirement | Where / how it is proven |
| --- | --- |
| Local mode unchanged | Original suite unmodified except two flagged assertions; `localMode.test.tsx` (byte-for-byte keys); `storeSwap.test.ts` (no local-key writes, local restored without writing, corrupt entry untouched); local mode makes **no** request to a personal table and creates no sync key (`sync.test.tsx`). |
| Never auto-upload / map / merge / delete local data | Sign-in and sign-out tests; the sign-out regression (section 6); the sample curriculum's ids can never be queued (UUID validation, tested). |
| Account mode uses separate storage | Per-user keys; `sync.test.tsx` asserts every write during sync goes to an account key. |
| Published-only reads, explicit paging | `supabaseCurriculum.test.ts` (filters on every call; 2,300 chapters and 2,300 focus rows across pages); real stack: 2,500 rows past the real API cap. |
| Real M5 data stays draft | Untouched; `test-real-bundle.sh` and staged publication pass; empty-state test; DB fixture scenarios run on the fake fixture only. |
| No new schema | `git status` shows nothing under `supabase/`. |
| 20 M7 behaviours | `enrollment.test.tsx`, `cascade.test.ts`, `supabaseEnrollments.test.ts`, `supabaseCurriculum.test.ts`, `validate/cache/paging` tests, and real-stack scenarios 1–5. |
| M8 mapping / hydration / outbox / concurrency / timer | `mappers.test.ts`, `outbox.test.ts`, `engine.test.ts` (including two tabs, midnight split, duplicate focus blocks). The timer's own state is in no entity. |
| 18 real-stack scenarios | `scripts/db/test-sync-integration.sh`, listed in section 7. |
| Selector parity, local vs account | `selectorParity.test.ts` (same numbers for completion, group completion, subject stats, weak areas, streaks, planned minutes, revision buckets, achievements and search; plus a negative control showing the comparison can fail). |
| Negative controls | Demo exclusion, user isolation (RLS), pending-op preservation, stale overwrite refused, duplicate writes, draft never read, account-switch isolation, parity comparison can fail. |

---

## 5. Hosted isolation and secrets
- The integration scripts read the local URL and the **public** key from `supabase status` and refuse any host that is not `127.0.0.1` / `localhost` (API and database).
- No service-role key in the frontend, in GitHub Actions or in a browser environment variable. The only new CI step uses the local stack the workflow already starts.
- No hosted project was created, no hosted migration applied, no curriculum published, nothing deployed.
- The integration test installs the **fake** fixture into the local database and removes it afterwards. It refuses to start unless every shared curriculum table is empty (so it cannot touch real data) and asserts they are empty again at the end. I verified the local database was clean after every run, and ran `supabase db reset` after `test-committed.sh` (which, by design, leaves its fixture committed) to leave a clean local database.

---

## 6. Things found while building (all fixed unless noted)

1. **A sign-out data leak, caught by a test I wrote for the sign-out guard.** On sign-out the stores swap back to the local sample data. The sync subscription was still alive for a moment and treated that swap as the student's edits, queuing the *local sample chapters* (`p5-1`, …) into the account's outbox. They would not have been accepted by the database, but that is exactly "uploading local data". Fixed in three independent layers: the store mode now flips to local *before* the local state goes back in; the engine takes an `isBound()` gate and does nothing (capture, send, pull, apply, hydrate) when it is false; and entity validation refuses any chapter or subject id that is not a database UUID. Each layer has its own regression test.
2. **The always-visible shell showed the local profile name, course and sample exam date under an account** while it was loading, onboarding or in an error state. It now uses a small hook that shows no name and only the account's own course until the stores are bound.
3. `lucide-react` 0.446 has no `CloudCheck` icon and `tsc -p .` did not catch it (the root config only references the others); caught at run time by a test. I also now run the real `npm run typecheck` (app + scripts configs).
4. Two concurrency bugs in my own first draft of the engine, caught by tests: a tab constructing its outbox *before* another tab queued a change then overwrote the queue on its first save (the outbox now re-reads before every change); and a conflict's losing edit was re-queued by the very next capture (conflict handling now measures later edits against what was captured before the request).

---

## 7. Real local-stack scenarios (23, all pass; 19–23 are in section 13)
1 options from the view with both groups · 2 Group I only, then Group II later with no id change · 3 a draft chapter is never returned · 4 enrol through the function; refuses an unavailable group, a second active enrolment and a direct insert · 5 change attempt/groups, archive, re-activate, one active · 6 hydrate, send once, database totals equal the client's · 7 repeated write creates no duplicate · 8 planned session linked to its focus record, re-linked on a new device · 9 midnight split, summed per day by the database · 10 two devices edit one record: server wins, loser sees a log entry · 11 incremental pull and deletion reconciliation across devices · 12 database refuses a rule-breaking row, the rest still go · 13 a revision can be completed but never deleted · 14 another user can neither read nor write these rows (RLS) · 15 a second enrolment sees none of the first's records, and the first's are intact · 16 2,500 rows past the real API cap · 17 450 queued changes sent in batches of at most 200 · 18 per-account quota enforced and reported plainly.

## 8. Existing test expectations I changed (please look at these)
Both are M6 assertions that were true only because M6 had no enrolment; M7 legitimately widens them. Neither was weakened to make a failure pass.

- `localMode.test.tsx`, "signing in does not upload, change or reset local data": previously "every table operation is a read of `profiles` / `user_settings`". Signing in now also **reads** the student's enrolment and the shared course records it refers to. The invariant it protects (reads only; nothing about study data goes anywhere) is kept and sharpened: reads only, from a named list of account and shared-curriculum tables, and **never** a personal study table.
- `screens.test.tsx`, account screen: previously "no enrolment or curriculum selection". M7 adds the which-data switch (its text mentions the enrolment); enrolment itself lives in Settings. The assertion now covers what the page must still never offer: deletion, import, upload.

I also kept the M6 headline sentence "Signing in does not sync your progress yet." for the not-syncing case (so that test is untouched) and reworded the second sentence; while an account's data is on screen the page says it is saved to the account.

## 9. Performance (local stack, one run; indicative, not a benchmark)
| Operation | Time |
| --- | --- |
| Hydrate 2,500 focus rows (3 pages) and rebuild the snapshot | about 60 ms |
| Incremental pull, nothing changed (2,500 known rows) | about 55 ms |
| ID reconciliation over 2,500 rows | about 55 ms |
| Send 450 queued changes (3 batches, one request per change) | about 1.1–1.2 s |

Sending is one request per change by design (so each change gets its own idempotency, conditional write and outcome). For a typical day that is a handful of requests; the large-backlog case (a long offline stretch) is the 450-change case above. If that ever matters, the repository can send bulk inserts for new rows without changing the engine.

---

## 10. Decisions (confirmed in review)

1. **Profile, settings and the student's own dates are synced** in this PR (section 13).
2. **Revisions stay cancel-only.** No database deletion is added.
3. **Existing focus-record and chapter-status behaviour is kept** (a completed focus record also moves a not-started chapter to "learning", so logging time queues two changes).
4. **One request per operation** is accepted for the MVP. Bulk optimisation can be considered in M10.
5. **Retired chapters with a student's history stay visible** as historical records; new students are not offered retired chapters.
6. **Server wins, with persistent loss reporting**, for every synced record including the new ones.
7. **Twelve-attempt retry policy** kept, with recoverable set-aside operations.
8. **Web Locks with the storage-lease fallback** kept.
9. **The two narrowed M6 assertions are accepted**, with their strengthened replacements.

## 11. Not done, on purpose (out of scope as briefed)
M9 import wizard and deletion UI · sample-curriculum migration · topics schema · new curriculum content · AI/Gemini · scraping · Realtime · cross-device live timers · storage buckets · admin dashboard · any hosted-project work.

## 12. Commands to reproduce
```
npm run typecheck && npm run lint && npm test && npm run build
npm run guard:secrets && npm run guard:secrets -- --dist dist
supabase db reset && supabase test db && supabase db lint --schema public --level warning
bash scripts/db/test-importer.sh && bash scripts/db/test-real-bundle.sh && bash scripts/db/test-staged-publication.sh
bash scripts/db/test-auth-integration.sh
bash scripts/db/test-sync-integration.sh        # new; needs the local stack, installs and removes the fake fixture
bash scripts/db/test-two-tab.sh --mutate        # new; real Chrome pages; also proves the test fails without the protections
bash scripts/db/test-committed.sh               # run last: it leaves its fixture committed (supabase db reset afterwards)
```
CI: the new integration step is added to `.github/workflows/database.yml`, right after the auth integration and before the committed-behaviour step (which leaves its fixture committed and would otherwise trip the new test's clean-database check).

---

## 13. Final requirement 1 — profile, settings and exam-date sync

**What syncs** (three single-row records, always present, only ever *updated*; key `self`):

| Record | Synced columns | Never synced or client-controlled |
| --- | --- | --- |
| `profiles` | `display_name` | avatar (stays on the device), time zone, onboarding flag |
| `user_settings` | daily and weekly target hours, study start and end, focus / short break / long break minutes, long-break interval, theme | |
| `student_enrollments` | `exam_date_override`, `final_revision_date` | `user_id`, `csv_id`, `exam_attempt_id`, `status`, identity and ownership columns; the attempt's official date |

- **Only a student-defined date is an override.** An empty date, or a date equal to the attempt's official one, is sent as "no override" (null). The official date is never written (tested in the fake backend and on the real stack: `exam_attempts` still has no dates).
- **Existing mechanisms only, no migration.** Updates go through the column grants and ownership policies the schema already has, are conditional on the `updated_at` the edit was based on, and rely on the existing timestamp trigger. The update statement is built from a fixed column list for each table, so no other column can be sent from the browser. `git status` shows nothing under `supabase/migrations`.
- **Same conflict policy.** A clash with another device keeps the server value, shows it on screen, and records the losing value in the persistent conflict log (visible in the sync panel as "Your name", "Your settings", "Your exam dates"). Values the database refuses (dates outside 2000–2100, a final revision after the exam) are set aside, recoverable (Try again / Discard), while the rest of the changes still go. Obvious format errors never enter the queue.
- **Where the values live.** They are applied to the account store only; nothing is written to `cma-study-os`, `cma-study-os-timer` or `cma-study-os-ui` (tested through the real `<App />` by spying on every storage write). Hydration fills in a missing server row from the store, so hydrating is never itself a change.
- The Settings copy is updated again: it now says these are saved to the account, replacing the interim "kept on this device for now".

**Tests added:** mapper tests (what travels, override rule, round trip, validation, device-only fields kept); engine tests on the fake backend (persist across devices; profile, settings, exam-date and final-revision conflicts, each checking the server value shown, the loss logged and still there next session; invalid date set aside; malformed date never queued; offline edits; only the allowed columns updated, never insert/delete; switching users cannot expose another user's name, settings or dates; the two accounts' storage keys stay apart); an app-level test that nothing reaches a local-only key; and real-stack scenarios 19–23:

19 name, every setting and both dates saved, and a second device sees them · 20 editing nothing sends nothing, and identity columns and the official date are untouched · 21 profile, settings, exam-date and final-revision conflicts: server wins, each loss logged · 22 the existing database constraints reject 1999, 2101 and a final revision after the exam; set aside, recoverable, the rest still goes · 23 another user can neither read nor change this user's name, settings or dates, nor `status` or `user_id` of an enrolment.

---

## 14. Final requirement 2 — real two-browser-page sign-out test

`scripts/db/test-two-tab.sh` (driver `scripts/db/two-tab-test.ts`). It builds the app for the local stack, serves it, and drives **real Chrome** with `playwright-core`: two pages in one browser context, so they share one origin, one storage and one signed-in session, as two tabs do. It uses the fake fixture (installed and removed, with the same clean-database guards as the sync integration) and an account created over the local API.

Steps, with the checks that failed first if broken: both pages signed in and bound to the account's data → the second page queues a legitimate change (the data API is made unreachable so it cannot be sent) → the first page signs out, is told the change is unsaved, and signs out anyway → the second page receives the sign-out through the browser's own events and leaves the account → **no sync request** to a personal table or the account's own rows afterwards → **no local sample data** (`p5-…`) written into the outbox, set-aside log or conflict log, on either page (a write hook records any attempt) → the three local-mode keys are **byte-for-byte unchanged** → the per-user outbox **kept the pending change** and the account's own data is still on the device.

**It fails when a protection is removed.** `--mutate` builds two copies of the app, each with one protection removed, and runs the same scenario, which must fail:
- remove the sign-out ordering protection (the store mode flips to local only *after* the local data returns) → **detected**: 888 sample-data writes into the sync keys, the set-aside log full of sample chapters, the pending change lost;
- remove the unbinding guard (`isBound`) → **detected**: the same.

Each fails on its own, because they work in series; with both present, and the third layer (UUID validation), the scenario is clean. The script refuses if a mutation target is not found, so a refactor cannot make the mutation test silently meaningless.

Honest notes: the data-API block is applied to the whole browser context, so the first page's own flush also cannot succeed, which is why the "unsaved changes" prompt appears (that exercises the sign-out guard too). A request that was already in flight for the shared course list is retried by the client library for a few seconds after sign-out; it is a read of public curriculum, not the sync engine, and is not counted as a sync request. The test needs a Chrome binary (`CHROME_PATH`, or the usual locations; present on the GitHub runner). `playwright-core` is a **dev dependency only** (no browser download; no runtime dependency added).

---

## 15. Final validation (run after both requirements)

| Check | Result |
| --- | --- |
| Vitest, all | 813 passed, 42 skipped (opt-in suites) |
| Auth integration | 19 passed |
| Enrolment + sync integration | 23 passed |
| Two real browser pages | passes; both mutations detected |
| pgTAP | 789 passed |
| Importer, real bundle, staged publication, committed behaviour | all pass |
| Curriculum importer tests | 121 passed |
| Typecheck / ESLint / build | 0 errors / 0 problems / succeeds |
| Secret guard | repo (345 files) and built bundle (389 files) clean |
| Schema lint | no errors |

Confirmed: the real M5 curriculum is still draft-only (real-bundle and staged-publication tests pass; nothing under the curriculum data changed) · no hosted Supabase project was contacted (every script refuses a non-local host) · no migration was added or changed · no privileged credential was introduced (only the public local key is used) · no local data was uploaded (two-tab and sync tests) · local-mode tests and behaviour are intact (original suite unmodified apart from the two accepted assertions) · all outbox, set-aside and conflict data remain recoverable (persisted per user, Try again / Discard / Export). The local database was left clean (`supabase db reset` after the committed-behaviour script).

One flake fixed along the way: a 1-second lookup timeout in a full-app test tripped while the machine was busy running database scripts; the two full-app test files now allow 6 seconds.
