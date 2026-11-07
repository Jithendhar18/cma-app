# Database ERD (design only)

Status: proposal. Companion to `database-schema.md`, which has the full column lists, constraints and lifecycle rules.

How to read it:

- Crow's-foot cardinality. `||` means exactly one, `o|` zero or one, `|{` one or many, `o{` zero or many.
- `csv_id` is shorthand for `course_syllabus_version_id`. It is repeated on most tables because **composite foreign keys use it to prove a row's parent is in the same course-and-syllabus scope**. Those composite keys cannot be drawn in Mermaid; they are listed under the diagrams.
- Only key columns and the columns needed to understand a relationship are shown.

## 1. Shared curriculum

```mermaid
erDiagram
    courses ||--o{ course_syllabus_versions : "has versions"
    syllabus_versions ||--o{ course_syllabus_versions : "applies to courses"
    course_syllabus_versions ||--o{ course_attempt_availability : "offered in"
    exam_attempts ||--o{ course_attempt_availability : "supports"
    course_syllabus_versions ||--|{ subject_groups : "has groups"
    subject_groups ||--|{ subjects : "contains papers"
    subjects ||--o{ syllabus_sections : "has sections"
    syllabus_sections ||--o{ syllabus_sections : "parent of"
    subjects ||--|{ chapters : "has chapters"
    syllabus_sections ||--o{ chapters : "groups"
    chapters ||--o| chapters : "superseded by"
    subjects ||--o{ official_weightages : "weighted at subject level"
    syllabus_sections ||--o{ official_weightages : "weighted at section level"
    chapters ||--o{ official_weightages : "weighted at chapter level"
    course_syllabus_versions ||--o{ study_resources : "scoped to"
    subjects ||--o{ study_resources : "scoped to"
    chapters ||--o{ study_resources : "scoped to"
    exam_attempts ||--o{ study_resources : "scoped to"
    source_references ||--o{ courses : "verifies"
    source_references ||--o{ chapters : "verifies"
    source_references ||--o{ official_weightages : "verifies"
    source_references ||--o{ study_resources : "verifies"

    courses {
        uuid id PK
        text stable_key UK
        text name
        text status
    }
    syllabus_versions {
        uuid id PK
        text stable_key UK
        date effective_from "null if unverified"
        text status
    }
    course_syllabus_versions {
        uuid id PK
        uuid course_id FK
        uuid syllabus_version_id FK
        text status
    }
    exam_attempts {
        uuid id PK
        smallint year
        text session "june or december"
        date exam_start_date "null until official"
        text date_status
    }
    course_attempt_availability {
        uuid id PK
        uuid csv_id FK
        uuid exam_attempt_id FK
        text status "draft, enabled, disabled"
    }
    subject_groups {
        uuid id PK
        uuid csv_id FK
        text name
        smallint sort_order
    }
    subjects {
        uuid id PK
        uuid csv_id FK
        uuid subject_group_id FK
        text slug
        smallint paper_number
        text name
    }
    syllabus_sections {
        uuid id PK
        uuid csv_id FK
        uuid subject_id FK
        uuid parent_section_id FK
        text official_label
        smallint sort_order
    }
    chapters {
        uuid id PK
        uuid csv_id FK
        uuid subject_id FK
        uuid section_id FK "nullable"
        text stable_key
        smallint sequence_no
        uuid superseded_by_chapter_id FK
    }
    official_weightages {
        uuid id PK
        text level "subject, section or chapter"
        uuid subject_id FK "exactly one of three"
        uuid section_id FK "exactly one of three"
        uuid chapter_id FK "exactly one of three"
        numeric min_percent
        numeric max_percent
        text published_label
    }
    study_resources {
        uuid id PK
        text resource_type
        text url
        text link_status
        uuid subject_id FK "optional scope"
        uuid chapter_id FK "optional scope"
    }
    source_references {
        uuid id PK
        text title
        text url
        date retrieved_on
    }
    curriculum_import_batches {
        uuid id PK
        text bundle_key
        text content_sha256
    }
```

`curriculum_import_batches` has no relationships. It is an audit log of applied seed bundles.

Composite foreign keys that guarantee scope (not drawn above):

| Child | Composite key | Parent | Guarantees |
| --- | --- | --- | --- |
| `subjects` | `(subject_group_id, csv_id)` | `subject_groups (id, csv_id)` | a subject's group is in the same course and syllabus |
| `syllabus_sections` | `(subject_id, csv_id)` | `subjects (id, csv_id)` | same scope |
| `syllabus_sections` | `(parent_section_id, subject_id)` | `syllabus_sections (id, subject_id)` | a parent section is in the same subject |
| `chapters` | `(subject_id, csv_id)` | `subjects (id, csv_id)` | same scope |
| `chapters` | `(section_id, subject_id)` | `syllabus_sections (id, subject_id)` | a chapter's section is in the same subject |
| `chapters` | `(superseded_by_chapter_id, csv_id)` | `chapters (id, csv_id)` | replacement is in the same scope |
| `official_weightages` | one composite key per level | `subjects`, `syllabus_sections`, `chapters` on `(id, csv_id)` | the target is in the same scope |
| `study_resources` | `(subject_id, csv_id)`, `(chapter_id, csv_id)` | `subjects`, `chapters` | resource scope is consistent |

## 2. Student data and its link to curriculum

```mermaid
erDiagram
    auth_users ||--|| profiles : "same id"
    profiles ||--|| user_settings : "has"
    profiles ||--o{ student_enrollments : "enrols"
    course_attempt_availability ||--o{ student_enrollments : "must be a supported combination"
    student_enrollments ||--|{ enrollment_groups : "prepares for"
    subject_groups ||--o{ enrollment_groups : "selected"
    student_enrollments ||--o{ chapter_progress : "tracks"
    chapters ||--o{ chapter_progress : "progress on"
    student_enrollments ||--o{ planner_sessions : "plans"
    chapters ||--o{ planner_sessions : "for"
    student_enrollments ||--o{ study_sessions : "logs focus"
    chapters ||--o{ study_sessions : "time on"
    planner_sessions ||--o{ study_sessions : "credited by"
    student_enrollments ||--o{ revisions : "schedules"
    chapters ||--o{ revisions : "revises"
    student_enrollments ||--o{ practice_records : "practises"
    chapters ||--o{ practice_records : "on"
    student_enrollments ||--o{ mock_tests : "sits"
    subjects ||--o{ mock_tests : "for paper"
    profiles ||--o{ local_import_runs : "imported"
    student_enrollments ||--o{ local_import_runs : "into"

    auth_users {
        uuid id PK
    }
    profiles {
        uuid id PK
        text display_name
        text time_zone
        timestamptz onboarding_completed_at
    }
    user_settings {
        uuid user_id PK
        numeric daily_target_hours
        smallint pomodoro_focus_minutes
        text theme
    }
    student_enrollments {
        uuid id PK
        uuid user_id FK
        uuid csv_id FK
        uuid exam_attempt_id FK
        text status "active or archived"
        date exam_date_override
        date final_revision_date
    }
    enrollment_groups {
        uuid enrollment_id PK
        uuid subject_group_id PK
    }
    chapter_progress {
        uuid id PK
        uuid enrollment_id FK
        uuid chapter_id FK
        text status
        smallint confidence
        date completed_on
    }
    planner_sessions {
        uuid id PK
        text client_id UK
        uuid chapter_id FK
        date planned_date
        time start_time
        smallint duration_minutes
        text status
    }
    study_sessions {
        uuid id PK
        text client_id UK
        uuid chapter_id FK
        date local_date
        smallint minutes
        text mode
        uuid planner_session_id FK "nullable"
    }
    revisions {
        uuid id PK
        text client_id UK
        uuid chapter_id FK
        smallint revision_number "1 to 4, 4 is final"
        date due_date
        date completed_on
        date cancelled_on
    }
    practice_records {
        uuid id PK
        text client_id UK
        uuid chapter_id FK
        date local_date
        smallint questions
        smallint correct
    }
    mock_tests {
        uuid id PK
        text client_id UK
        uuid subject_id FK
        date taken_on
        numeric score
        numeric max_score
    }
    local_import_runs {
        uuid id PK
        text source_sha256
    }
```

Composite foreign keys that guarantee ownership and scope (not drawn above):

| Child | Composite key | Parent | Guarantees |
| --- | --- | --- | --- |
| `enrollment_groups` | `(enrollment_id, user_id, csv_id)` | `student_enrollments (id, user_id, csv_id)` | the group row belongs to that user's enrolment |
| `enrollment_groups` | `(subject_group_id, csv_id)` | `subject_groups (id, csv_id)` | the group is in the enrolment's syllabus |
| `student_enrollments` | `(csv_id, exam_attempt_id)` | `course_attempt_availability (csv_id, exam_attempt_id)` | only a supported combination can be enrolled |
| `chapter_progress`, `planner_sessions`, `study_sessions`, `revisions`, `practice_records` | `(enrollment_id, user_id, csv_id)` | `student_enrollments (id, user_id, csv_id)` | **a row cannot reference another user's enrolment, and carries the enrolment's syllabus scope** |
| the same five tables | `(chapter_id, csv_id)` | `chapters (id, csv_id)` | **the chapter is in the enrolment's syllabus** |
| `mock_tests` | `(subject_id, csv_id)` | `subjects (id, csv_id)` | the paper is in the enrolment's syllabus |
| `study_sessions` | `(planner_session_id, user_id)` | `planner_sessions (id, user_id)` | a focus record can only credit the same user's planned session |

Together, `user_id` plus `csv_id` on every personal row mean that even if a row-level-security policy were mistakenly loosened, the **foreign keys alone** would still prevent cross-user and cross-syllabus references.

## 3. What each personal row points at

```text
auth.users ──1:1── profiles ──1:1── user_settings
                      │
                      └─1:n─ student_enrollments ──n:1── course_attempt_availability
                                  │                              │ (csv_id, exam_attempt_id)
                                  ├── enrollment_groups ──n:1── subject_groups
                                  ├── chapter_progress ─────┐
                                  ├── planner_sessions ─────┤
                                  ├── study_sessions ───────┼──n:1── chapters ──n:1── subjects
                                  ├── revisions ────────────┤
                                  ├── practice_records ─────┘
                                  └── mock_tests ───────────────n:1── subjects
```

## 4. Views (not drawn)

| View | Reads | Replaces |
| --- | --- | --- |
| `chapter_stats` | `study_sessions`, `practice_records` | stored chapter `actualHours`, `questionsPracticed`, `correctAnswers`, `lastStudied` |
| `daily_study_minutes` | `study_sessions` | the derived `StudyLog` |
| `enrollment_options` | published curriculum, enabled availability | hard-coded course, attempt and group choices |

All three are `security_invoker`, so they obey the caller's row level security.
