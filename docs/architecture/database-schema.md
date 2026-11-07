# Database Schema (design only)

Status: **proposal. Nothing has been created in any database.** SQL fragments are illustrative and have not been executed.

> **Implementation note (M1/M2):** the shared-curriculum parts of this design are now built. Where the build differs from the text below, see `m1-m2-review.md` §7 (deviations).

Target: Supabase PostgreSQL (Postgres 15 or newer; confirm the project's version when it is created).

## 0. Conventions

- Names are `snake_case`. Schema is `public`. All tables have row level security enabled (see `rls-security.md`).
- **Primary keys are `uuid`** (`gen_random_uuid()`), except pure join tables.
- **`stable_key`** (text) identifies seeded curriculum rows. It is human-readable, assigned in the seed files, immutable and never reused. It is what makes imports idempotent.
- **`client_id`** (text) identifies user-created rows for idempotent writes. It carries the id format the app already generates (for example `focus-<sessionKey>`), so existing logic keeps working.
- **`csv_id`** is the column name for a reference to `course_syllabus_versions(id)`. It appears on almost every table so that **composite foreign keys can prove everything in a row belongs to the same course-and-syllabus scope**.
- Enumerations are `text` with a `CHECK` constraint rather than Postgres `enum` types, because adding a value to a check constraint is a simple migration while altering an enum is awkward.
- Every table has `created_at timestamptz not null default now()`. Every personal data table also has `updated_at`, maintained by a `set_updated_at()` trigger, so clients can pull only rows changed since their last sync.
- Free-text columns have length limits (for example `notes` ≤ 5000) so one user cannot bloat a free-tier database.
- Dates the app treats as calendar days are `date`. Wall-clock times of day are `time`. Instants are `timestamptz`.
- `ON DELETE` is stated for every foreign key. Shared curriculum uses **RESTRICT** towards anything personal, so curriculum can never be deleted out from under a student.

### Publication and verification gate (all shared tables)

Every shared curriculum table has:

| Column | Type | Rule |
| --- | --- | --- |
| `status` | text | `draft` \| `published` \| `retired` |
| `verified_at` | timestamptz null | when a human verified it against an official source |
| `source_reference_id` | uuid null → `source_references` | where it was verified |

`CHECK (status <> 'published' OR (verified_at IS NOT NULL AND source_reference_id IS NOT NULL))` on every shared table. **Nothing unverified can be published, and the app only ever sees `published` or `retired` rows.**

## 1. Shared curriculum

### 1.1 `courses`

A course level: Foundation, Intermediate, Final.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `stable_key` | text not null unique | for example a short code chosen in the seed file |
| `name` | text not null | display name |
| `level_order` | smallint not null | ordering of courses |
| `status`, `verified_at`, `source_reference_id` | | gate above |

Lifecycle: created by seed only. Never deleted if referenced (RESTRICT).

### 1.2 `syllabus_versions`

A syllabus *scheme*, independent of any course. The same scheme can apply to several courses.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `stable_key` | text not null unique | |
| `name` | text not null | |
| `effective_from` | date null | **null when not verified**; never guessed |
| `gate columns` | | |

### 1.3 `course_syllabus_versions` (CSV)

Which syllabus versions exist *for which course*. This is the scope that subjects, groups, sections and chapters belong to. A subject belongs to a course **and** a syllabus version, never just one of them.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | referenced everywhere as `csv_id` |
| `course_id` | uuid not null → `courses(id)` ON DELETE RESTRICT | |
| `syllabus_version_id` | uuid not null → `syllabus_versions(id)` ON DELETE RESTRICT | |
| `gate columns` | | |

Constraints: `UNIQUE (course_id, syllabus_version_id)`.

### 1.4 `exam_attempts`

An examination session. Independent of course and syllabus.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `stable_key` | text not null unique | |
| `year` | smallint not null | |
| `session` | text not null | `june` \| `december` |
| `label` | text not null | for example "December 2026" |
| `exam_start_date`, `exam_end_date` | date null | **null until an official date is verified** |
| `date_status` | text not null default `unannounced` | `unannounced` \| `provisional` \| `official` |
| `gate columns` | | |

Constraints: `UNIQUE (year, session)`; `CHECK (exam_end_date IS NULL OR exam_start_date IS NOT NULL AND exam_end_date >= exam_start_date)`; `CHECK (date_status = 'unannounced' OR exam_start_date IS NOT NULL)`.

The app must show "date not announced" when `exam_start_date` is null. It must never substitute a guessed date.

### 1.5 `course_attempt_availability`

The supported combinations of (course + syllabus version) and attempt. **This table is the only thing that makes an attempt selectable.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `csv_id` | uuid not null → `course_syllabus_versions(id)` ON DELETE RESTRICT | |
| `exam_attempt_id` | uuid not null → `exam_attempts(id)` ON DELETE RESTRICT | |
| `status` | text | `draft` \| `enabled` \| `disabled` (plus the shared gate) |

Constraints: `UNIQUE (csv_id, exam_attempt_id)`.

Rules:

- Multiple attempts can reference the same syllabus version (several rows with the same `csv_id`).
- `enabled` requires that the CSV and the attempt are both `published` and that the CSV is **ready** (see 1.14). Enforced by a trigger, and re-checked by CI on the seed data.
- Disabling a row does not delete it, so existing enrolments stay valid as history.

### 1.6 `subject_groups`

A group of papers within a CSV (for example Group I and Group II). Fully data-driven, so a different course can have one group, three, or none.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `csv_id` | uuid not null → CSV ON DELETE RESTRICT | |
| `stable_key` | text not null | |
| `name` | text not null | |
| `sort_order` | smallint not null | |

Constraints: `UNIQUE (csv_id, stable_key)`, `UNIQUE (csv_id, sort_order)`, **`UNIQUE (id, csv_id)`** (target for composite foreign keys).

### 1.7 `subjects` (papers)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `csv_id` | uuid not null | |
| `subject_group_id` | uuid not null | |
| `stable_key` | text not null | |
| `slug` | text not null | URL-safe identifier used in routes, replacing the hard-coded `p6` |
| `paper_number` | smallint not null | |
| `name` | text not null | official name |
| `short_name` | text not null | display only |
| `sort_order` | smallint not null | |

Constraints and foreign keys:

- `FOREIGN KEY (subject_group_id, csv_id) REFERENCES subject_groups (id, csv_id) ON DELETE RESTRICT`. **A subject cannot belong to a group from a different course or syllabus.**
- `UNIQUE (csv_id, stable_key)`, `UNIQUE (csv_id, slug)`, `UNIQUE (csv_id, paper_number)`, **`UNIQUE (id, csv_id)`**.

### 1.8 `syllabus_sections`

Optional hierarchy between a subject and its chapters (a section, and sections within sections). Official ordering and numbering are preserved.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `csv_id` | uuid not null | |
| `subject_id` | uuid not null | |
| `parent_section_id` | uuid null | self-reference for nesting |
| `stable_key` | text not null | |
| `official_label` | text null | the numbering or heading exactly as published, for example "Section A" |
| `title` | text not null | |
| `sort_order` | smallint not null | position among siblings |

Constraints:

- `FOREIGN KEY (subject_id, csv_id) REFERENCES subjects (id, csv_id) ON DELETE RESTRICT`.
- `FOREIGN KEY (parent_section_id, subject_id) REFERENCES syllabus_sections (id, subject_id) ON DELETE RESTRICT`. **A parent must be in the same subject.**
- `UNIQUE (id, subject_id)`, `UNIQUE (id, csv_id)`, `UNIQUE (csv_id, stable_key)`.
- `UNIQUE (subject_id, parent_section_id, sort_order)` with `NULLS NOT DISTINCT` (Postgres 15). If the project is on an older version, use two partial unique indexes.
- A trigger rejects cycles.

### 1.9 `chapters`

The shared, official chapter. **Contains no personal data.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | the target of all personal references |
| `csv_id` | uuid not null | |
| `subject_id` | uuid not null | |
| `section_id` | uuid null | null when the subject has no sections |
| `stable_key` | text not null | immutable, never reused |
| `official_label` | text null | numbering exactly as published |
| `title` | text not null | |
| `sequence_no` | smallint not null | subject-wide official order |
| `suggested_study_hours` | numeric(5,1) null | **app-suggested planning aid, not an official figure**; null until someone provides one. Replaces today's sample `estimatedHours`. |
| `superseded_by_chapter_id` | uuid null | set when a chapter is split, merged or replaced |
| `gate columns` | | |

Constraints:

- `FOREIGN KEY (subject_id, csv_id) REFERENCES subjects (id, csv_id) ON DELETE RESTRICT`.
- `FOREIGN KEY (section_id, subject_id) REFERENCES syllabus_sections (id, subject_id) ON DELETE RESTRICT`. **A chapter's section must be in the same subject.** The default `MATCH SIMPLE` lets `section_id` be null.
- `FOREIGN KEY (superseded_by_chapter_id, csv_id) REFERENCES chapters (id, csv_id)`.
- `UNIQUE (csv_id, stable_key)`, `UNIQUE (subject_id, sequence_no)`, **`UNIQUE (id, csv_id)`**, `UNIQUE (id, subject_id)`.

Lifecycle: **never hard-deleted once referenced.** Removal from the syllabus sets `status = 'retired'`. Student progress rows reference chapters with `ON DELETE RESTRICT`.

### 1.10 `official_weightages`

Weightages exactly at the level ICMAI publishes them. **Never derived or distributed down to children.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `csv_id` | uuid not null | |
| `level` | text not null | `subject` \| `section` \| `chapter` |
| `subject_id`, `section_id`, `chapter_id` | uuid null | exactly one is set, matching `level` |
| `min_percent`, `max_percent` | numeric(5,2) | a single published value sets both equal; a published range sets both ends |
| `published_label` | text not null | the wording as published (for example a range as printed) |
| `gate columns` | | |

Constraints:

- `CHECK ((level='subject' AND subject_id IS NOT NULL AND section_id IS NULL AND chapter_id IS NULL) OR (level='section' AND section_id IS NOT NULL AND subject_id IS NULL AND chapter_id IS NULL) OR (level='chapter' AND chapter_id IS NOT NULL AND subject_id IS NULL AND section_id IS NULL))`.
- `CHECK (min_percent >= 0 AND max_percent <= 100 AND min_percent <= max_percent)`.
- Composite foreign keys to `subjects(id, csv_id)`, `syllabus_sections(id, csv_id)` and `chapters(id, csv_id)` so the target is in the same CSV.
- Unique per target and source: `UNIQUE (level, subject_id, section_id, chapter_id, source_reference_id)` with `NULLS NOT DISTINCT`.

The rule "do not fabricate chapter weightages from section percentages" is enforced by design (no derivation column, no trigger, no view that spreads a parent value) and by a CI test that asserts the seed bundle contains no chapter-level weightage unless a source for chapter-level data is attached.

### 1.11 `study_resources`

Metadata and official links only. **No documents are stored.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `stable_key` | text not null | |
| `resource_type` | text not null | `study_material` \| `mcq_bank` \| `model_question_paper` \| `previous_question_paper` \| `notice` \| `timetable` \| `other` |
| `title` | text not null | |
| `url` | text not null | `CHECK (url ~ '^https://')` |
| `publisher` | text not null default `ICMAI` | |
| `is_official` | boolean not null | |
| `csv_id`, `subject_id`, `chapter_id`, `exam_attempt_id` | uuid null | optional scope; all composite-checked against the same CSV |
| `year`, `session` | smallint, text null | for previous papers |
| `link_status` | text not null default `active` | `active` \| `broken` \| `retired` |
| `last_checked_at` | timestamptz null | when a human or a manually-run script last opened the link |
| `gate columns` | | |

Constraints: `UNIQUE (stable_key)`; scope foreign keys as above (`(subject_id, csv_id)`, `(chapter_id, csv_id)`).

Outdated or broken links are **disabled, not deleted**: `link_status` set to `broken` or `retired`. Clients hide anything not `active`.

### 1.12 `source_references`

Provenance for every verified fact. Needed to satisfy "source references and verification timestamps".

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `stable_key` | text unique | |
| `title` | text not null | |
| `url` | text null | |
| `document_type` | text | for example notification, syllabus document, study material page |
| `published_on` | date null | |
| `retrieved_on` | date not null | when a human read it |
| `note` | text null | |

### 1.13 `curriculum_import_batches`

Audit trail of seed applications. Not readable by clients.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `bundle_key` | text not null | for example the course and syllabus the bundle covers |
| `bundle_version` | text not null | |
| `content_sha256` | text not null | |
| `applied_at` | timestamptz not null default now() | |
| `summary` | jsonb | counts of inserted, updated and retired rows |

Constraints: `UNIQUE (bundle_key, content_sha256)`, so applying the same bundle twice is recognised as a no-op.

### 1.14 Curriculum readiness (a function, not a table)

A CSV is **ready** to be offered when:

1. The CSV, its course and its syllabus version are `published`.
2. It has at least one published subject group.
3. Every published group has at least one published subject.
4. Every published subject has at least one published chapter.

`enrollment_options` (a view) and the `enabled` trigger on `course_attempt_availability` both rely on it. This is how the app guarantees **it only shows options for which verified data exists.**

## 2. Student data

All personal tables have `user_id uuid not null REFERENCES profiles(id) ON DELETE CASCADE`. Deleting an account therefore removes everything personal in one cascade.

### 2.1 `profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK → `auth.users(id)` ON DELETE CASCADE | same id as the auth user |
| `display_name` | text not null | 1–80 characters |
| `avatar_data_url` | text null | `CHECK (avatar_data_url IS NULL OR (avatar_data_url ~ '^data:image/(jpeg|png|webp);base64,' AND length(avatar_data_url) <= 200000))`. The client already shrinks to about 60 KB. Open decision whether to keep this or drop avatar sync (see implementation plan). |
| `time_zone` | text not null default `Asia/Kolkata` | display and analytics context only. Dates are **not** derived from it. |
| `onboarding_completed_at` | timestamptz null | |

Created by a trigger on `auth.users` insert. Clients cannot insert or delete it.

### 2.2 `user_settings`

| Column | Type | Maps from `Settings` |
| --- | --- | --- |
| `user_id` | uuid PK → `profiles` | |
| `daily_target_hours` | numeric(4,1) | `dailyTargetHours` (1–16) |
| `weekly_target_hours` | numeric(5,1) | `weeklyTargetHours` (1–100) |
| `study_start_time`, `study_end_time` | time | `studyStartTime`, `studyEndTime` (`end > start`) |
| `pomodoro_focus_minutes` | smallint | 5–180 |
| `short_break_minutes` | smallint | 1–60 |
| `long_break_minutes` | smallint | 1–90 |
| `long_break_every` | smallint | 2–10 |
| `theme` | text | `dark` \| `light` \| `system` |
| `updated_at` | timestamptz | |

Check constraints mirror the validation already in `SettingsPage`.

### 2.3 `student_enrollments`

A student's enrolment in a course and syllabus version for an attempt. **All personal progress hangs off an enrolment.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid not null → `profiles` ON DELETE CASCADE | |
| `csv_id` | uuid not null | |
| `exam_attempt_id` | uuid not null | |
| `status` | text not null | `active` \| `archived` |
| `exam_date_override` | date null | the student's own date when none is official, or if they prefer one. Replaces `examDate` + `examDateIsSample`. |
| `final_revision_date` | date null | replaces `finalRevisionDate` |
| `started_at` | timestamptz not null default now() | |
| `archived_at` | timestamptz null | |
| `updated_at` | timestamptz not null | |

Constraints:

- `FOREIGN KEY (csv_id, exam_attempt_id) REFERENCES course_attempt_availability (csv_id, exam_attempt_id) ON DELETE RESTRICT`. **An enrolment can only exist for a supported combination.**
- Partial unique index: `UNIQUE (user_id) WHERE status = 'active'`. **One active enrolment per student**, any number archived (open decision, see implementation plan).
- `UNIQUE (id, user_id)`, `UNIQUE (id, csv_id)`, **`UNIQUE (id, user_id, csv_id)`** (targets for composite foreign keys below).
- `CHECK (final_revision_date IS NULL OR exam_date_override IS NULL OR final_revision_date <= exam_date_override)`.
- A trigger rejects inserting or re-pointing an enrolment at an availability row whose status is not `enabled`.

The effective exam date is `coalesce(exam_date_override, exam_attempts.exam_start_date)`. When both are null, the UI shows "not announced" and asks the student for a date.

### 2.4 `enrollment_groups`

Which groups the student prepares for. "Group I", "Group II" or "Both" is simply one or two rows.

| Column | Type | Notes |
| --- | --- | --- |
| `enrollment_id` | uuid not null | |
| `subject_group_id` | uuid not null | |
| `user_id` | uuid not null | |
| `csv_id` | uuid not null | |

PK `(enrollment_id, subject_group_id)`.

Foreign keys: `(enrollment_id, user_id, csv_id) → student_enrollments (id, user_id, csv_id) ON DELETE CASCADE`; `(subject_group_id, csv_id) → subject_groups (id, csv_id) ON DELETE RESTRICT`. **A student cannot select a group from a different syllabus, and cannot attach groups to someone else's enrolment.** A trigger requires at least one group per active enrolment.

### 2.5 `chapter_progress`

The personal half of today's `Chapter`.

| Column | Type | Maps from | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | | |
| `user_id`, `enrollment_id`, `csv_id`, `chapter_id` | uuid | | |
| `status` | text | `status` | `not_started` \| `learning` \| `practising` \| `completed` \| `revision_due` \| `exam_ready` |
| `confidence` | smallint | `confidence` | 1–5 |
| `notes` | text | `notes` | ≤ 5000 chars |
| `completed_on` | date null | `completedOn` | an event, so stored |
| `updated_at` | timestamptz | | optimistic concurrency token |

Foreign keys: `(enrollment_id, user_id, csv_id) → student_enrollments (id, user_id, csv_id) ON DELETE CASCADE`; **`(chapter_id, csv_id) → chapters (id, csv_id) ON DELETE RESTRICT`**.
Constraint: `UNIQUE (enrollment_id, chapter_id)`.

A row exists only once a student has touched a chapter. An absent row means `not_started`, `confidence` 1, no notes (matching today's defaults).

**Not stored (derived instead):** actual hours, questions practised, correct answers, last studied. See 2.10.

### 2.6 `planner_sessions`

Planned blocks (today's `StudySession`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `client_id` | text not null | for example `s-<uuid>` |
| `user_id`, `enrollment_id`, `csv_id`, `chapter_id` | uuid | same composite pattern as 2.5 |
| `planned_date` | date not null | |
| `start_time` | time not null | |
| `duration_minutes` | smallint not null | 5–600 |
| `status` | text not null | `upcoming` \| `in_progress` \| `completed`. **`missed` is derived**: an `upcoming` session whose date has passed. `missed` is *accepted* on import and mapped to `upcoming`. |
| `priority` | text not null | `high` \| `medium` \| `low` |
| `notes` | text | |
| `updated_at` | timestamptz | |

Constraints: `UNIQUE (user_id, client_id)`, `UNIQUE (id, user_id)`.
Index: `(user_id, planned_date)`.

A planned session crossing midnight is stored as **one row**. Day splitting happens only when it is *completed*, when it creates per-day `study_sessions` rows, exactly as `splitPlannedSession` does today.

### 2.7 `study_sessions` (actual focused time)

Today's `FocusRecord`. **The single stored source of study time.** One row per calendar day of a block.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `client_id` | text not null | the existing id: `focus-<sessionKey>`, `focus-<sessionKey>@<date>`, `plan-<sessionId>`, `plan-<sessionId>@<date>` |
| `user_id`, `enrollment_id`, `csv_id`, `chapter_id` | uuid | composite pattern |
| `local_date` | date not null | **authoritative day for all aggregation**, assigned on the device in local time, as today |
| `minutes` | smallint not null | 1–1440 |
| `mode` | text not null | `pomodoro` \| `stopwatch` \| `planner` |
| `started_at` | timestamptz null | optional audit instant for new data; null for imported history |
| `notes` | text | |
| `planner_session_id` | uuid null | |
| `updated_at` | timestamptz not null | maintained by trigger; lets clients pull only what changed |

Constraints:

- **`UNIQUE (user_id, client_id)`** prevents duplicate logging. Writes use `INSERT … ON CONFLICT (user_id, client_id) DO NOTHING`.
- `FOREIGN KEY (planner_session_id, user_id) REFERENCES planner_sessions (id, user_id) ON DELETE SET NULL (planner_session_id)`. **Deleting a planned session keeps the logged time and detaches it**, matching `deleteSession` today. The column-list form of `SET NULL` needs Postgres 15; confirm.
- Indexes: `(user_id, local_date)`, `(enrollment_id, chapter_id)`.

Day-boundary accounting: the database never converts instants to dates. The client computes `local_date` and the per-day minutes (existing `splitIntervalByDay` and `allocateMinutes`), so the "total never changes at midnight" guarantee is preserved unchanged. Time zone changes cannot rewrite history.

### 2.8 `revisions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `client_id` | text not null | for example `rev-<uuid>` |
| `user_id`, `enrollment_id`, `csv_id`, `chapter_id` | uuid | composite pattern |
| `revision_number` | smallint not null | 1, 2, 3 or 4 (**4 = final**), mapped to and from `'final'` in the client |
| `due_date` | date not null | |
| `completed_on` | date null | |
| `cancelled_on` | date null | |
| `priority` | text | |
| `updated_at` | timestamptz | |

Constraints:

- `CHECK (revision_number BETWEEN 1 AND 4)`.
- **`CHECK (completed_on IS NULL OR cancelled_on IS NULL)`**: never both.
- `UNIQUE (user_id, client_id)`.
- **`UNIQUE (enrollment_id, chapter_id) WHERE completed_on IS NULL AND cancelled_on IS NULL`**: at most one pending revision per chapter (rule 1 in the current-state doc).
- `UNIQUE (enrollment_id, chapter_id, revision_number) WHERE cancelled_on IS NULL`: one live revision per number, while cancelled history can repeat.
- Index: `(user_id, due_date) WHERE completed_on IS NULL AND cancelled_on IS NULL`.

Cancelled revisions are kept. Nothing deletes a completed or cancelled revision. Scheduling logic (1 → 7 → 21 days → final, continue after the highest completed) stays in the client's tested pure functions; the database enforces the invariants above. The "numbers have no gaps" rule is checked by tests, not by a constraint.

### 2.9 `practice_records` and `mock_tests`

`practice_records`:

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `client_id`, `user_id`, `enrollment_id`, `csv_id`, `chapter_id` | | composite pattern |
| `local_date` | date not null | |
| `questions` | smallint not null | > 0 |
| `correct` | smallint not null | `CHECK (correct BETWEEN 0 AND questions)` |
| `updated_at` | timestamptz not null | maintained by trigger |

`UNIQUE (user_id, client_id)`. Index `(user_id, local_date)`, `(enrollment_id, chapter_id)`.

`mock_tests`:

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `client_id`, `user_id`, `enrollment_id`, `csv_id` | | |
| `subject_id` | uuid not null | `FOREIGN KEY (subject_id, csv_id) → subjects (id, csv_id)` |
| `taken_on` | date not null | |
| `name` | text not null | 1–100 chars |
| `score`, `max_score` | numeric(7,2) | `CHECK (max_score > 0 AND score BETWEEN 0 AND max_score)` |
| `updated_at` | timestamptz not null | maintained by trigger |

### 2.10 `local_import_runs`

Records that a particular local backup was imported, so a retry cannot import it twice.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id`, `enrollment_id` | uuid | |
| `source_sha256` | text not null | hash of the normalised file |
| `counts` | jsonb | rows imported per entity |
| `imported_at` | timestamptz | |

`UNIQUE (user_id, source_sha256)`. Combined with `client_id` uniqueness, import is idempotent at two levels.

### 2.11 Derived data: views, not columns

Both views are created `WITH (security_invoker = true)` so row level security applies to the *caller*, not the view owner.

- **`chapter_stats`**: per `(enrollment_id, chapter_id)`: `actual_minutes`, `questions`, `correct`, `last_studied`. Built from two separate aggregates (study time, practice) joined afterwards, to avoid the row-multiplication a direct join would cause. Replaces the stored `actualHours`, `questionsPracticed`, `correctAnswers`, `lastStudied`.
- **`daily_study_minutes`**: per `(enrollment_id, local_date)`. Replaces `StudyLog`.

Not stored anywhere: streaks, consistency, XP, level, badges, completion percentages, weak areas, revision buckets. These stay as the existing pure functions in `lib/analytics.ts` and `lib/achievements.ts`.

`enrollment_options` is a third view over published curriculum and enabled availability (defined in `frontend-migration.md` §5), feeding the dropdowns.

## 3. Functions and triggers (names only; behaviour specified in `rls-security.md`)

| Name | Kind | Purpose |
| --- | --- | --- |
| `handle_new_user()` | trigger on `auth.users` | create `profiles` and `user_settings` |
| `set_updated_at()` | trigger | maintain `updated_at` |
| `enforce_immutable_columns()` | trigger | reject changes to `user_id`, `enrollment_id`, `csv_id`, `chapter_id`, `client_id` after insert |
| `create_enrollment(csv_id, attempt_id, group_ids[], replace_active)` | RPC, security definer | atomic enrolment with validation; archives the previous active enrolment only when `replace_active` is true |
| `change_enrollment_attempt(enrollment_id, attempt_id)` | RPC, security definer | move to another attempt of the same CSV, preserving progress |
| `set_enrollment_groups(enrollment_id, group_ids[])` | RPC, security definer | change the selected groups; never deletes progress |
| `activate_enrollment(enrollment_id)` | RPC, security definer | make an archived enrolment active again; archives the current active one in the same transaction |
| `archive_enrollment(enrollment_id)` | RPC, security definer | archive without deleting data |
| `delete_my_account()` | RPC, security definer | delete the caller's auth user; cascades |
| `csv_is_ready(csv_id)` | function | readiness rule (1.14) |
| `check_availability_enabled()` | trigger | enable gate (1.5) and enrolment selectability (2.3) |

## 4. Table count

| Group | Tables | Count |
| --- | --- | --- |
| Shared curriculum | `courses`, `syllabus_versions`, `course_syllabus_versions`, `exam_attempts`, `course_attempt_availability`, `subject_groups`, `subjects`, `syllabus_sections`, `chapters`, `official_weightages`, `study_resources`, `source_references`, `curriculum_import_batches` | 13 |
| Personal | `profiles`, `user_settings`, `student_enrollments`, `enrollment_groups`, `chapter_progress`, `planner_sessions`, `study_sessions`, `revisions`, `practice_records`, `mock_tests`, `local_import_runs` | 11 |
| **Total** | | **24 tables, 3 views** |

Beyond your list (11 curriculum + 9 personal named), the additions are `source_references` and `curriculum_import_batches` (provenance and audit, required by the seeding rules), `enrollment_groups` (a student can choose one or both groups), and `local_import_runs` (idempotent local-data import).

## 5. Lifecycle and cascade summary

| Event | Behaviour |
| --- | --- |
| Account deleted | `auth.users` → `profiles` → every personal table: **CASCADE**. Shared curriculum is untouched. |
| Enrolment archived | Row kept with `status='archived'`; all its progress stays and remains queryable. |
| Enrolment deleted (not exposed to clients) | Would cascade its progress; only possible through account deletion. |
| Chapter removed from syllabus | `status='retired'`; **never deleted**. Progress rows keep pointing at it (RESTRICT). Optional `superseded_by_chapter_id`. |
| Subject, group, section, CSV removed | Same: retire, never delete. |
| Attempt availability disabled | Row kept. Existing enrolments unaffected. New enrolments blocked. |
| Planned session deleted | Logged time kept; `planner_session_id` set to null. |
| Study session deleted by user | Row deleted; chapter stats update automatically (derived). |
| Revision cancelled | `cancelled_on` set; row kept as history. |
| Resource link breaks | `link_status='broken'`; hidden from clients; row kept. |

## 6. Indexing

Primary access paths and their indexes:

| Query | Index |
| --- | --- |
| Hydrate a student's focus history | `study_sessions (user_id, local_date)` |
| Incremental pull of changed rows | `(user_id, updated_at)` on each personal data table |
| Chapter statistics | `study_sessions (enrollment_id, chapter_id)`, `practice_records (enrollment_id, chapter_id)` |
| Planner for a day or range | `planner_sessions (user_id, planned_date)` |
| Due revisions | partial `revisions (user_id, due_date)` where pending |
| Curriculum tree | `subjects (csv_id, sort_order)`, `chapters (subject_id, sequence_no)`, `syllabus_sections (subject_id, parent_section_id, sort_order)` |
| RLS checks | every personal table is indexed on `user_id` (the leading column of the indexes above, or an explicit index) |

Foreign key columns used by composite foreign keys are covered by the `UNIQUE` constraints that act as their targets. Add explicit indexes on referencing columns (`chapter_id`, `enrollment_id`) so that RESTRICT checks and cascades do not scan.

## 7. Capacity estimate (rough; to be measured)

One student-year at a heavy usage of about 4 focus blocks, 1 practice entry and 3 planned sessions a day is on the order of 1,500 focus rows, 400 practice rows and 1,100 planner rows, plus a few hundred revisions and progress rows. At roughly 150–250 bytes per row plus indexes, that is about **1–3 MB per student per year**. The Supabase Free database allowance (verify the current figure; it was 500 MB when this was written) therefore covers on the order of a couple of hundred student-years. Measure with real data before relying on this.
