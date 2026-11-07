# Curriculum Seeding (design only)

Status: proposal. No importer, bundle or migration exists yet.

> **Implementation note (M1/M2):** the shared-curriculum parts of this design are now built. Where the build differs from the text below, see `m1-m2-review.md` §7 (deviations).

Principles:

- The curriculum is **collected and verified by a person**, once, and checked into the repository as structured JSON.
- **No scraping, no AI services, no scheduled jobs, no automated ingestion.**
- The JSON files in git are the source of truth. The database is a deployed copy of them.
- Importing is repeatable and safe to run twice. It can add, correct, reorder and retire curriculum. **It can never delete anything a student points at.**
- Nothing is invented. Anything not verified stays `null`, and the app shows it as "not available" rather than guessing.

## 1. What is in the first dataset

Intended first dataset: **CMA Intermediate, Syllabus 2022, December 2026 attempt.**

Verification status of what exists today:

| Item | Where it exists now | Treat as |
| --- | --- | --- |
| Course "CMA Intermediate", eight papers (5 to 12), their names and Group I / II split | `src/data/subjects.ts` and the project brief | **plausible, but unverified until a source reference is attached** |
| Syllabus "2022" | the project brief | to be verified; `effective_from` stays null until a source gives it |
| December 2026 attempt | the project brief | the attempt label is fine to create; **`exam_start_date` stays null** (`date_status = unannounced`) until an official date exists |
| Chapters and sections | `src/data/subjects.ts` | **not official.** The file itself calls them sample outlines. Do **not** copy them into the database |
| Weightages | none | do not create any until a source is in hand |
| Resource links | the three ICMAI listing pages named in the brief | candidates; verify each in a browser before publishing |

Because publishing requires verification and readiness (schema §1.14), the database will **not offer** a course to students until every published subject has verified chapters. Until then the app keeps working in local mode with the bundled sample curriculum.

## 2. Repository layout (proposed)

```text
supabase/
  migrations/                      generated and hand-written SQL, applied in order
  curriculum/
    schema/                        the JSON format description (TypeScript types)
    shared/
      attempts.json                exam attempts
      sources.json                 source references used by any bundle
    bundles/
      intermediate-2022/
        bundle.json                identity, version, and what the bundle covers
        structure.json             groups, subjects, sections, chapters
        weightages.json            only what ICMAI publishes, at the published level
        resources.json             official links and metadata
        availability.json          which attempts this course and syllabus is offered in
scripts/curriculum/
  validate.ts                      pure validator (no database), unit-tested
  generate-sql.ts                  deterministic JSON → SQL
```

Nothing under `supabase/` or `scripts/curriculum/` exists yet; this is the target shape.

## 3. Import format

All files are JSON with a `schemaVersion`. Every record has a `stableKey`. References between records use stable keys, never database ids, so a bundle means the same thing in every environment.

### 3.1 `bundle.json`

```json
{
  "schemaVersion": 1,
  "bundleKey": "<course-key>.<syllabus-key>",
  "bundleVersion": "1",
  "course":   { "stableKey": "<course-key>", "name": "<verified name>", "levelOrder": 2 },
  "syllabus": { "stableKey": "<syllabus-key>", "name": "<verified name>", "effectiveFrom": null },
  "verification": { "sourceRef": "<source stableKey>", "verifiedAt": "<ISO date once verified, else null>" }
}
```

### 3.2 `sources.json`

```json
[
  {
    "stableKey": "<source-key>",
    "title": "<document or page title as published>",
    "url": "<https url or null>",
    "documentType": "notification | syllabus | study-material-page | other",
    "publishedOn": null,
    "retrievedOn": "<date a person read it>",
    "note": "<optional internal remark>"
  }
]
```

Every verified fact points at one of these.

### 3.3 `structure.json`

```json
{
  "groups": [
    { "stableKey": "<group-key>", "name": "<verified name>", "sortOrder": 1 }
  ],
  "subjects": [
    {
      "stableKey": "<subject-key>", "slug": "<url-slug>", "group": "<group-key>",
      "paperNumber": 0, "name": "<official name>", "shortName": "<display name>", "sortOrder": 1,
      "sourceRef": "<source-key>", "verifiedAt": "<date>"
    }
  ],
  "sections": [
    {
      "stableKey": "<section-key>", "subject": "<subject-key>", "parent": null,
      "officialLabel": "<numbering exactly as published, or null>",
      "title": "<as published>", "sortOrder": 1,
      "sourceRef": "<source-key>", "verifiedAt": "<date>"
    }
  ],
  "chapters": [
    {
      "stableKey": "<chapter-key>", "subject": "<subject-key>", "section": null,
      "officialLabel": "<numbering exactly as published, or null>",
      "title": "<as published>", "sequenceNo": 1,
      "suggestedStudyHours": null,
      "supersededBy": null,
      "sourceRef": "<source-key>", "verifiedAt": "<date>"
    }
  ]
}
```

All values in angle brackets are placeholders that show the *shape*. They are not data.

### 3.4 `weightages.json`

```json
[
  {
    "level": "subject | section | chapter",
    "target": "<stable key of the subject, section or chapter>",
    "minPercent": 0, "maxPercent": 0,
    "publishedLabel": "<the exact wording as published>",
    "sourceRef": "<source-key>", "verifiedAt": "<date>"
  }
]
```

### 3.5 `resources.json`

```json
[
  {
    "stableKey": "<resource-key>",
    "resourceType": "study_material | mcq_bank | model_question_paper | previous_question_paper | notice | timetable | other",
    "title": "<as shown on the official page>",
    "url": "<https url>",
    "isOfficial": true,
    "scope": { "subject": null, "chapter": null, "attempt": null },
    "year": null, "session": null,
    "linkStatus": "active",
    "lastCheckedAt": "<when a person last opened it>",
    "sourceRef": "<source-key>", "verifiedAt": "<date>"
  }
]
```

Only metadata and the official link are stored. **No document is copied into storage.**

### 3.6 `shared/attempts.json` and `availability.json`

```json
[ { "stableKey": "<attempt-key>", "year": 2026, "session": "december", "label": "December 2026",
    "examStartDate": null, "examEndDate": null, "dateStatus": "unannounced",
    "sourceRef": "<source-key>", "verifiedAt": "<date>" } ]
```

```json
[ { "bundle": "<bundleKey>", "attempt": "<attempt-key>", "status": "enabled" } ]
```

Adding a future attempt means adding one record to each file. No schema change and no code change.

## 4. Validation before anything touches a database

`validate.ts` is a pure function over the JSON (no database needed). It runs locally, in CI on every pull request, and as the first step of generating SQL. It fails the import on any of:

| Check | Why |
| --- | --- |
| `schemaVersion` known; unknown fields rejected | catches typos |
| every `stableKey` unique within its type; matches the allowed character set | idempotency depends on it |
| every cross-reference resolves (group, subject, section, parent, supersededBy, scope, sourceRef, attempt) | no dangling references |
| a section's parent is in the same subject; no cycles | hierarchy integrity |
| `sortOrder` and `sequenceNo` unique and contiguous within their parent | preserves official order |
| `paperNumber` unique within the bundle | |
| every published record has `sourceRef` and `verifiedAt` | the publication gate |
| `verifiedAt` is not in the future; `retrievedOn` is not after `verifiedAt` | catches typos |
| URLs are `https`; no duplicate `(resourceType, url)` | no duplicate resources |
| weightages: exactly one target; `level` matches the target's type; `0 ≤ min ≤ max ≤ 100` | |
| **no chapter-level weightage unless its own source says so, and none is ever computed** | do not fabricate chapter weightages from section percentages |
| exam dates: end ≥ start; `dateStatus ≠ unannounced` requires a start date | never invent a date |
| every subject has at least one chapter, every group at least one subject, before the bundle can be `published` | readiness |
| availability rows reference a published bundle and an existing attempt | |

Two further structural checks run on the **generated SQL**:

- it contains no `DELETE`, `TRUNCATE` or `DROP` against any curriculum table (a text scan; the one allowed removal path is an UPDATE to `retired`),
- it never mentions a personal table.

## 5. Idempotent import

The generator turns validated JSON into one deterministic SQL file per bundle version, wrapped in a single transaction:

```sql
begin;
-- 1. record the batch; if (bundle_key, content_sha256) already exists the whole file is a no-op
insert into curriculum_import_batches (...) values (...) on conflict do nothing;

-- 2. upsert in dependency order: sources, course, syllabus, csv, attempts, availability,
--    groups, subjects, sections, chapters, weightages, resources
insert into chapters (csv_id, stable_key, ...)
values (...)
on conflict (csv_id, stable_key) do update
  set title = excluded.title, sequence_no = excluded.sequence_no, section_id = excluded.section_id, ...
  -- never touches id, stable_key or created_at

-- 3. retire what the bundle no longer lists, in this bundle's scope only
update chapters set status = 'retired'
 where csv_id = :csv and stable_key <> all (:keys_in_bundle) and status <> 'retired';

-- 4. publish only if the readiness rule holds; otherwise leave as draft and raise
update ... set status = 'published' where ...;
commit;
```

Properties:

- **Idempotent:** running the same file twice changes nothing. Running a revised file updates only what differs.
- **Stable identity:** matching is on `stable_key`, so a row's uuid never changes, so every student reference stays valid.
- **Ordering updates:** `sequence_no` and `sort_order` unique constraints are `DEFERRABLE INITIALLY DEFERRED`, so swapping two chapters in one transaction is legal.
- **No duplicates:** the unique constraints on `(csv_id, stable_key)` and the resource uniqueness rule make duplicates impossible even if the validator were bypassed.
- **Transactional:** any failed statement rolls the whole import back. The readiness check at the end can abort an incomplete import.

## 6. Version-aware updates

| Change | What the bundle does | Effect on students |
| --- | --- | --- |
| Fix a typo or title | edit the field, keep `stableKey` | none; titles update in place |
| Reorder chapters | change `sequenceNo` | none; progress follows the chapter, not its position |
| Move a chapter to another section | change `section` | none |
| Add a chapter | new `stableKey` | new row; students see it as `not_started` |
| Remove a chapter | omit it; the import sets `retired` | progress preserved; the chapter shows as retired, with its history |
| Split, merge or replace a chapter | add new keys; set `supersededBy` on the old one; old is retired | history intact; the app can offer to carry progress over (a later feature) |
| New syllabus version | **new** `syllabusKey`, new CSV, new keys. The old bundle stays | existing enrolments keep their old CSV; students opt into the new one |
| New exam attempt | add one record to `attempts.json` and `availability.json` | none for current students; selectable once enabled |
| Disable an attempt | `availability.status = disabled` | current enrolments keep working; new ones blocked |

**Never reuse a `stableKey`.** A key is derived from the title when first created and then frozen; order lives in `sequenceNo`, not in the key, so reordering never renames anything.

## 7. Student progress is never deleted

Guaranteed by four independent mechanisms, so no single mistake can destroy data:

1. Foreign keys from every personal table to curriculum are `ON DELETE RESTRICT`.
2. Retiring is a status change, not a delete.
3. The SQL generator and the CI scan reject `DELETE`, `TRUNCATE` and `DROP` in curriculum imports.
4. The import runs with no knowledge of personal tables and never references them.

## 8. Source references and verification process

The rule: **a human reads the official source, then records where and when.** Nothing is published without it.

### 8.1 What counts as a source

Official ICMAI publications: the syllabus document, examination notifications and timetables, official study material and its index pages, and the official MCQ, model paper and previous paper pages. Third-party summaries, coaching sites, social posts and AI output are **not** sources.

### 8.2 Step by step

1. **Collect.** Open the official source in a browser. Record a `source_references` entry: title as published, URL, document type, publication date if shown, and `retrievedOn` = today.
2. **Enter.** Type the data into the JSON, copying titles and numbering exactly as published. Leave anything unclear as `null`; never infer.
3. **First check.** Run `validate.ts`. Fix structural errors.
4. **Second pass.** On a different day (or by a second person if one is available), re-read each record against the source with fresh eyes, ticking a checklist: names, numbering, order, section membership, counts per subject.
5. **Sign off.** Only after the second pass, set `verifiedAt` and `status = published` for the records that were checked. Anything not rechecked stays `draft`.
6. **Review.** The change goes through a pull request. The reviewer compares the diff to the source for a sample of records and confirms the checklist is complete.
7. **Apply.** The maintainer applies the generated SQL (see `rls-security.md` §7).

### 8.3 Specific rules

- **Weightages:** record at the level and in the wording ICMAI publishes. If a source gives percentages per section, store them on sections and **leave chapters without a weightage.** The UI shows the weightage at the level it exists and says nothing for the levels below.
- **Exam dates:** `unannounced` until an official notification exists; then `official` with a source. A provisional date from anywhere unofficial is not recorded.
- **Chapters:** the sample outlines in the app are not a source. They are not imported.
- **Estimated hours:** `suggestedStudyHours` is an app planning aid, not an official figure. It stays null unless the maintainer deliberately supplies one, and it is labelled as a suggestion in the UI.

## 9. Resource links

- Only the official link and descriptive metadata are stored. No PDF or document is copied into Supabase Storage, which also keeps free-tier storage unused.
- `linkStatus` is `active`, `broken` or `retired`. Clients show only `active` links. Setting a link to `broken` or `retired` is an ordinary re-import of that one record; nothing is deleted.
- `lastCheckedAt` is set when a person opens the link. Optionally a small script run **by hand** (`npm run curriculum:check-links`, a later nice-to-have) can issue plain HTTP requests to the links and print a report for the maintainer to act on. It is never scheduled and never writes to the database.

## 10. Rollback and recovery

| Situation | Response |
| --- | --- |
| The import fails halfway | the transaction rolls back; nothing changed |
| A published value is wrong | fix the JSON and re-import (an update in place). The uuid and student links are unaffected |
| A whole bundle version is wrong | re-import the previous bundle version from git. Because matching is by `stable_key`, this restores field values and re-publishes rows the bad version retired |
| A row must disappear from view urgently | set it to `retired` (still visible, marked retired) or, only if no student has used it yet, back to `draft` (hidden) |
| Database damage | Backups are not available on the Free plan (**verify**). Before each production import, the maintainer takes a manual `pg_dump` of the curriculum tables (`--data-only`, curriculum schema only) and keeps it. The git history of the JSON bundles is the authoritative recovery source for curriculum. Personal data is separate and can be backed up by each student through the existing export file |
| Wrong `stable_key` published | never rename a key. Add the correct row, set `supersededBy`, retire the wrong one |

Every import is recorded in `curriculum_import_batches` with a content hash, so it is always possible to tell which bundle version is live.

## 11. Local development and CI

- `supabase db reset` rebuilds a local database from migrations plus the generated seed, so every developer and CI run starts from the same curriculum.
- CI validates the JSON and the generated SQL on pull requests, then applies it to a throwaway local Supabase and runs the readiness and integrity tests (`phase2-implementation-plan.md` §9). No hosted project and no production credential is involved.
