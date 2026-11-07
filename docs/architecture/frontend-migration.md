# Frontend Migration to Supabase (design only)

Status: proposal. No application code is changed by this phase.

## 1. Principles

1. **The UI does not change.** Pages, components and the pure selectors in `src/lib` keep their current inputs. The migration happens beneath them.
2. **Zustand stays.** Store actions keep their names and behaviour, so the 166 existing tests remain valid.
3. **Local mode keeps working exactly as today**, with the bundled sample curriculum. Account mode is additive.
4. **Local data is never modified by signing in**, and never uploaded automatically. Upload is an explicit, previewed import.
5. **A network failure can never lose or corrupt local data.** The device is the first place every change is written.
6. **Writes are idempotent**, so retries, refreshes and second tabs cannot duplicate anything.

## 2. Target architecture

```text
  Pages and components            (unchanged)
          │
  Pure selectors (lib/analytics, selectors, achievements)       (unchanged)
          │  same shapes in, same shapes out
  Zustand stores: studyStore, timerStore, uiStore               (actions unchanged)
          │                                   ▲
          │ entity-level changes              │ hydrated rows
          ▼                                   │
  Sync engine  ── outbox (per user, persisted) ──┐
          │                                       │
  Repository interfaces ───────────────────────────┘
     ├─ LocalRepository      (today's localStorage persistence)
     └─ SupabaseRepository   (personal data; RLS-protected)

  CurriculumProvider  ◄── CurriculumRepository
     ├─ BundledCurriculum    (today's data/subjects.ts, local mode)
     └─ SupabaseCurriculum   (shared, read-only, cached)
```

Two modes, chosen by whether a user is signed in:

| | Local mode | Account mode |
| --- | --- | --- |
| Curriculum | bundled sample (today's `subjects.ts`) | `SupabaseCurriculum` for the active enrolment |
| Personal data | `cma-study-os` in localStorage | per-user mirror `cma-study-os:<userId>` plus server |
| Demo data | yes (flagged, rolls forward) | **never** (empty until the student adds data) |
| Enrolment | none (as today) | required (onboarding) |

## 3. Mapping from Zustand to the database

### 3.1 `studyStore.settings`

| Field | Destination |
| --- | --- |
| `name` | `profiles.display_name` |
| `avatar` | `profiles.avatar_data_url` (or stays local; open decision) |
| `course` | derived from the enrolment's course name |
| `examAttempt` | derived from the enrolment's attempt `label` |
| `examDate`, `examDateIsSample` | `student_enrollments.exam_date_override`, falling back to `exam_attempts.exam_start_date`; "sample" disappears because an unknown date is simply `null` |
| `finalRevisionDate` | `student_enrollments.final_revision_date` |
| `examGroups` | rows in `enrollment_groups` |
| `dailyTargetHours`, `weeklyTargetHours`, `studyStartTime`, `studyEndTime`, `pomodoro*`, `shortBreakMinutes`, `longBreakMinutes`, `longBreakEvery`, `theme` | `user_settings` |

A selector, `selectSettings()`, recomposes today's `Settings` shape from these three sources so `ExamCountdownCard`, `SettingsPage`, `useThemeSync` and revision scheduling need no changes.

### 3.2 Entities

| Zustand entity / field | Table | Notes |
| --- | --- | --- |
| `Subject` | `subjects` (+ `subject_groups`) | from the curriculum provider; `id` becomes the uuid, routes use `slug` |
| `Chapter` curriculum fields (`id`, `subjectId`, `order`, `title`, `estimatedHours`) | `chapters` | `order` → `sequence_no`; `estimatedHours` → `suggested_study_hours` (nullable) |
| `Chapter.status`, `confidence`, `notes`, `completedOn` | `chapter_progress` | row created on first change |
| `Chapter.actualHours`, `questionsPracticed`, `correctAnswers`, `lastStudied` | **view `chapter_stats`** | no longer stored or synced |
| `StudySession` | `planner_sessions` | `date`→`planned_date`, `startTime`→`start_time`, `durationMinutes`→`duration_minutes`; stored `missed` imports as `upcoming` |
| `FocusRecord` | `study_sessions` | `date`→`local_date`; `id`→`client_id`; `sessionId`→`planner_session_id` |
| `PracticeRecord` | `practice_records` | `date`→`local_date` |
| `MockExam` | `mock_tests` | `date`→`taken_on` |
| `RevisionTask` | `revisions` | `'final'` ↔ `4`; `cancelledOn`→`cancelled_on` |
| `studyLog` (derived) | view `daily_study_minutes` or computed client-side as today | |
| `meta.seedAnchor`, every `demo` flag | **local only** | never uploaded |
| `exportVersion` file | unchanged portable backup | importable through the same adapter |

### 3.3 Other stores

| Store | Destination |
| --- | --- |
| `timerStore` running state | **device-local only**, key namespaced per user. Not synced |
| `timerStore` selection (mode, subject, chapter, notes, cycle count) | local; revalidated against the loaded curriculum at startup (chapter ids are uuids in account mode) |
| `uiStore.sidebarCollapsed` | local |
| `uiStore.paletteOpen` | in memory |

### 3.4 Identifiers on the client

- In account mode, **entity ids on the client stay the existing `client_id` strings** (`s-<uuid>`, `focus-<key>`, `rev-<uuid>`…). The server uuid primary key is not needed by the UI. This keeps every existing action, test and id-matching rule (`plan-<id>` vs `plan-<id>@<date>`) untouched.
- **Curriculum ids are the server uuids.** `chapterId` and `subjectId` become uuids; routes use `subjects.slug`.

## 4. Repository layer

Small interfaces; two implementations each. Nothing outside the sync engine and the providers imports Supabase.

```ts
// illustrative signatures, not code to add now
interface CurriculumRepository {
  listEnrollmentOptions(): Promise<EnrollmentOption[]>;               // dropdown data
  loadCurriculum(csvId: string): Promise<CurriculumTree>;             // groups, subjects, sections, chapters
  listResources(csvId: string): Promise<LibraryDocument[]>;           // feeds the existing Library UI
}

interface PersonalRepository {
  pullAll(enrollmentId: string): Promise<PersonalRows>;               // hydration
  pullChanges(enrollmentId: string, since: PullCursor): Promise<PersonalRows>;
  pullIds(enrollmentId: string): Promise<IdIndex>;                    // deletion reconciliation
  push(batch: OutboxOp[]): Promise<PushResult>;                       // idempotent
}

interface EnrollmentRepository {
  create(input: NewEnrollment): Promise<Enrollment>;                  // RPC create_enrollment
  changeAttempt(id: string, attemptId: string): Promise<Enrollment>;
  setGroups(id: string, groupIds: string[]): Promise<Enrollment>;
  activate(id: string): Promise<Enrollment>;
  archive(id: string): Promise<Enrollment>;
}
```

Pure mapping functions (`rowsToSnapshot`, `snapshotToRows`, `fromRevisionNumber`/`toRevisionNumber`) sit beside the repositories and carry most of the unit tests.

Shared reads and personal reads are deliberately separate:

| | Curriculum (shared) | Personal |
| --- | --- | --- |
| Changes | rarely (a seed release) | constantly |
| Caching | long-lived cache, revalidated on start | mirrored locally, synced incrementally |
| Auth | any signed-in user | RLS to the owner |
| Failure effect | cached copy keeps the app usable | local mirror keeps the app usable |

## 5. Curriculum provider

`CurriculumProvider` exposes a `useCurriculum()` hook returning `{ subjects, groups, chapters, status }`. It replaces the **20 non-test files** that import `@/data/subjects` today (51 references to `SUBJECTS`). The data shape matches the existing `Subject` type plus `slug` and `groupName`, so the change at each call site is mechanical.

To keep pages and selectors unchanged, a `selectChapters()` joins three sources into today's `Chapter` view-model:

```text
chapters (curriculum)  +  chapter_progress (personal)  +  chapter_stats view (derived)  →  Chapter
```

Loading behaviour:

1. On startup, read the cached curriculum for the active enrolment from local storage and render immediately.
2. Revalidate in the background (cheap query comparing the CSV's latest `updated_at` or an import-batch hash). Replace the cache only when it changed and the new payload validates.
3. If there is no cache and the network fails, show the error state with Retry; do not fall back silently to the sample curriculum in account mode, because that would attach progress to the wrong chapters.

### `enrollment_options` view

One read provides all dropdown data. Conceptually:

```sql
-- illustrative
create view enrollment_options with (security_invoker = true) as
select c.id as course_id, c.name as course_name,
       csv.id as csv_id, sv.id as syllabus_version_id, sv.name as syllabus_name,
       a.id as attempt_id, a.label as attempt_label,
       a.exam_start_date, a.date_status,
       (select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.sort_order)
          from subject_groups g where g.csv_id = csv.id and g.status = 'published') as groups
from course_attempt_availability caa
join course_syllabus_versions csv on csv.id = caa.csv_id
join courses c on c.id = csv.course_id
join syllabus_versions sv on sv.id = csv.syllabus_version_id
join exam_attempts a on a.id = caa.exam_attempt_id
where caa.status = 'enabled'
  and c.status = 'published' and sv.status = 'published'
  and csv.status = 'published' and a.status = 'published'
  and csv_is_ready(csv.id);
```

Only rows that satisfy every condition appear. **Courses, syllabus versions and attempts that are not verified, enabled and complete are never offered.**

## 6. Course and attempt selection

### 6.1 The four dropdowns

Cascading, all populated from `enrollment_options`:

| Step | Control | Source | Rule |
| --- | --- | --- | --- |
| 1 | Course | distinct `course_name` | only courses with at least one offered combination |
| 2 | Syllabus version | distinct syllabus for the chosen course | only versions with an enabled attempt |
| 3 | Exam attempt | attempts for the chosen course and version | shows the label; if `exam_start_date` is null it says "date not announced" |
| 4 | Groups | the CSV's groups | choose one group, or "Both" when there are two or more; at least one is required |

If a level has exactly one option it is preselected but still shown, so the student can see what they are enrolling in. If no options exist at all (nothing verified yet), the screen says that enrolment is not open yet and the student stays in local mode. The initial dataset will show **CMA Intermediate → Syllabus 2022 → December 2026 → Group I / Group II / Both**, and nothing else, unless more has been verified and enabled.

The Foundation and Final courses, and any other attempt, do not exist in the view until they are seeded, verified and enabled.

### 6.2 Changing enrolment without losing data

| What the student changes | Mechanism | Effect on existing data |
| --- | --- | --- |
| **Groups** (for example add Group II) | `set_enrollment_groups` | No data changes. Removing a group only hides its papers from group-filtered views (dashboard grids, countdown). All progress remains and returns if the group is re-added |
| **Attempt**, same course and syllabus (for example December 2026 → June 2027) | `change_enrollment_attempt` | Progress, sessions and history are kept. The exam date override and final revision date are cleared after a confirmation, because they referred to the old attempt; pending revisions keyed to the old final date are listed for the student to reschedule |
| **Course or syllabus version** | `create_enrollment(..., replace_active = true)` | The old enrolment is **archived, not deleted**, with all its progress. The new enrolment starts empty. Chapters in a different syllabus are different rows, so nothing is overwritten |
| **Switch back to an archived enrolment** | `activate_enrollment` | The current one is archived and the chosen one becomes active, intact |

Guards against accidental loss:

1. A confirmation dialog states what will happen in plain language and that nothing is deleted, with a one-click export first.
2. The timer must be idle; if a block is running the student is asked to finish or discard it first.
3. The outbox is flushed (or the student is told it cannot be) **before** the switch, so pending writes are not stranded under the wrong enrolment.
4. Switching is always reversible through "Past enrolments".
5. Carrying progress across syllabus versions is **not** attempted automatically. A future feature could use `superseded_by_chapter_id` to offer it.

## 7. Synchronisation design

### 7.1 Hydration (sign-in)

1. Read `profiles`, `user_settings`, the active enrolment, and its groups.
2. Load the curriculum for the enrolment's `csv_id` (cache first, §5).
3. Pull all personal rows for the enrolment: `chapter_progress`, `planner_sessions`, `study_sessions`, `practice_records`, `mock_tests`, `revisions`. Page through results with `range()`; do not rely on the platform's default row cap (**verify** the current default, 1,000 at the time of writing).
4. Map rows to the existing store shapes and write the per-user local mirror.
5. Only then render personal pages. Until then show loading skeletons.

All server rows are validated with the same style of validators already used by `parseSnapshot` before they are accepted. A malformed row is skipped and reported, never applied.

### 7.2 Writing: diff-based outbox

The stores stay the single place where state changes. A **sync engine** subscribes to the stores and works out *what changed*:

- Zustand updates are immutable, so unchanged entities keep the same object reference. Comparing arrays by reference finds changed, added and removed entities in linear time with no change to any action.
- Each change becomes an **outbox operation**: `{ opId, table, kind: upsert | delete, key, payload, baseUpdatedAt?, createdAt, attempts }`.
- The outbox is persisted per user (`cma-sync-outbox:<userId>`), so a refresh or a closed tab loses nothing.
- Operations are **coalesced**: repeated edits to one key collapse to the latest; insert-then-delete cancels out.
- Derived fields (`actualHours`, `questionsPracticed`, `correctAnswers`, `lastStudied`) and `demo`/`meta` are excluded from every payload by the mapping functions.
- Flush triggers: debounced after a change (about 1.5 s), when the browser comes back online, when the tab becomes visible, every minute while operations are pending, and before sign-out or an enrolment switch.
- Batches go out in dependency order: progress and planner sessions before the focus records that may reference a planner session; at most about 200 rows per request.

### 7.3 Idempotency and duplicate prevention

| Data | Server write | Why it is safe to repeat |
| --- | --- | --- |
| `study_sessions`, `practice_records`, `mock_tests` (append-only) | upsert on `(user_id, client_id)` with *ignore duplicates* (`ON CONFLICT DO NOTHING`) | the id is the idempotency key; an existing row is never rewritten |
| `planner_sessions`, `revisions`, `chapter_progress`, `user_settings`, `profiles`, enrolment dates | conditional update guarded by `updated_at` (§7.5), insert if absent | a repeat finds the row already in the desired state |
| deletes | delete by key | deleting an absent row is a no-op |

**Focus records and the timer.** The existing deterministic ids (`focus-<sessionKey>`, `focus-<sessionKey>@<date>`, `plan-<sessionId>`, `plan-<sessionId>@<date>`) become the `client_id`s. A block that is logged twice locally, recovered after a refresh, completed in two tabs, or retried after a network error therefore produces exactly one server row per day. The server-side unique constraint is the final guarantee even if client logic regressed.

### 7.4 Timer behaviour

- The running timer state is **device-local** and unchanged: timestamp-based, persisted, recovered after refresh.
- Only **completed** records reach the outbox. A block is never partially synced.
- Day-boundary accounting stays on the client (`splitIntervalByDay`, `allocateMinutes`). The client computes each record's `local_date`; the server stores it and never re-derives dates, so time zones cannot rewrite history.
- Two devices running timers produce different `sessionKey`s and therefore separate, legitimate blocks.
- Cross-device live timers are out of scope.

### 7.5 Conflicts and stale data

- **Append-only rows** cannot conflict (unique id, never updated by the client).
- **Mutable rows** carry the `updated_at` the client last saw (`baseUpdatedAt`). The write is `UPDATE … WHERE id = … AND updated_at = :base`. Zero rows affected means someone else changed it. The engine then fetches the current row and applies a **field-level three-way merge** (base, remote, local): a field changed only locally is re-applied, a field changed only remotely is kept, and a field changed on both sides takes the remote value and the local value is reported in the sync log so it is not lost silently. This is deliberately simple; the open decision in the implementation plan is whether plain "server wins" is acceptable instead.
- **Pulling changes:** after hydration the app pulls rows with `updated_at > cursor` (per table; indexed) when the tab regains focus and every few minutes while visible. **Deletions** are not visible to an `updated_at` query, so a lightweight reconcile fetches only `client_id`s (about 40 bytes per row) at sign-in, every 30 minutes, and on manual refresh, and removes local rows that no longer exist remotely (unless they still sit in the outbox). The alternative, tombstone columns, is a recorded open decision.
- Stale data never overwrites newer data: remote rows are applied only when their `updated_at` is newer than the local copy's, and never for a key with a pending local operation.

### 7.6 Multi-tab

- All tabs share the per-user local mirror and outbox and stay in step through the existing `storage`-event mechanism (`crossTab.ts`), now keyed per user.
- **One tab flushes at a time**, using the Web Locks API (`navigator.locks.request('cma-sync', { ifAvailable: true }, …)`). Where Web Locks is unavailable, every tab may flush; idempotent writes and `updated_at` guards make that safe, only a little wasteful.
- Sign-out in one tab signs out all tabs and clears in-memory personal state.

## 8. Errors, loading and empty states

| Situation | Behaviour |
| --- | --- |
| Network error, timeout, 5xx | keep the operation; retry with exponential backoff and jitter; status chip shows "Offline, N pending"; the app keeps working locally |
| 401 | refresh the token once; if that fails, pause syncing and ask the student to sign in again. **Nothing is discarded** |
| Unique violation on an append-only write | treated as success |
| RLS denial or constraint violation (a genuine bug or stale reference) | move to a **dead-letter list** with the reason; show a non-blocking banner "N changes could not be saved" with details and an export button. Never dropped silently |
| Hydration fails | keep the last local mirror; show a stale/offline indicator and a Retry action |
| Invalid server row | skipped, counted and reported; never applied |
| Curriculum fetch fails with no cache | error state with Retry (no silent fallback to sample curriculum in account mode) |
| No enrolment | onboarding |
| No data yet | existing empty states |

Sync status chip states: **Synced**, **Syncing**, **Offline (N pending)**, **Needs attention**. It reuses the existing badge style; no redesign.

## 9. Preserving and migrating local data

### 9.1 What stays untouched

- Signing up or in never reads, changes or deletes `cma-study-os`, `cma-study-os-timer` or `cma-study-os-ui`.
- In account mode the app uses namespaced keys, so a different user on the same browser never sees someone else's data, and returning to local mode shows exactly what was there before.
- Demo data is never uploaded, in any path.

### 9.2 One-time "import this browser's data" (explicit, previewed)

Offered once after onboarding if local data exists. It is a wizard, never automatic:

1. **Backup first.** A full export file is downloaded automatically.
2. **Exclude demo.** Records with the `demo` flag, and chapters still flagged `demo`, are dropped. If nothing remains, the wizard says so and ends.
3. **Chapter mapping.** The local chapters are *sample outlines*, so they cannot be matched to official chapters by id, and a match by title or position cannot be trusted automatically. Options considered:
   - (a) automatic match by paper number and chapter order: unsafe if the verified outline differs;
   - **(b) recommended: a mapping table** listing only the local chapters that carry the student's own data, each with a drop-down of official chapters in the same paper (or "Skip");
   - (c) import only chapter-independent data (settings, mock tests by paper number) and leave chapter-bound records in the backup.
4. **Preview** counts per entity and what will be skipped.
5. **Import** in batches through the same outbox path, using each record's existing `client_id`, so re-running is harmless. A `local_import_runs` row (unique on the file hash) stops a second import of the same data.
6. The summary lists anything skipped. The backup file remains the safety net.

The existing `exportVersion: 3` JSON files go through the same wizard, so older backups are importable too.

### 9.3 Local-only mode afterwards

Local mode remains available and unchanged for anyone who does not want an account (open decision: keep or retire after launch).

## 10. Should Zustand remain?

| Option | For | Against |
| --- | --- | --- |
| **Keep Zustand, add a small repository and sync engine (recommended)** | Zero change to 166 tests, actions and selectors; no new dependency; the offline-first write path we need (immediate local write, background sync) is natural here; the store is already the single mutation point, which is what the diff-based outbox needs | We own the sync code (outbox, backoff, merge) and must test it well |
| TanStack Query for server state, Zustand for UI | Mature caching, retries, refetch-on-focus | Fights the offline-first model: every mutation becomes a mutation hook and the UI would wait on, or optimistically mirror, server state; large rewrite of actions and tests; a new dependency |
| Redux Toolkit and RTK Query | Familiar patterns | Larger dependency and rewrite for no gain here |
| Realtime-first (Supabase Realtime subscriptions) | Live multi-device updates | Adds a moving part and free-tier connection limits (**verify**); not needed for a single-student tool |

Recommendation: **keep Zustand**. If a dependency is ever justified, TanStack Query could manage only the read-only curriculum cache. The default is none, to honour "minimal dependencies".

## 11. Impact on existing code (for the implementation phases)

| Area | Change |
| --- | --- |
| Curriculum access | 20 files: replace `import { SUBJECTS } from '@/data/subjects'` with `useCurriculum()`; routes use `slug` |
| Types | `PaperGroup` literal becomes a string; `Subject` gains `slug` and `groupName`; `Chapter` stays as the joined view-model |
| Settings consumers | none, via `selectSettings()` |
| Stores | add per-user key namespacing; actions unchanged |
| New modules | `features/auth`, `features/onboarding`, `lib/sync` (engine, outbox, mappers), `lib/repositories` |
| Unchanged | all of `lib/analytics`, `lib/achievements`, `lib/revisions`, `lib/focusSplit`, planner, timer logic, reports, library UI, theme |
| Local-only code | `data/seed.ts`, `demoRoll`, `legacyMigration` stay for local mode |
