# M5: CMA Intermediate Curriculum Review Package

Status: **approved as draft-only data and committed locally. Every record is still a DRAFT with empty verification fields, awaiting
the maintainer's human verification. Not pushed, not applied to any hosted project.** Nothing under `src/` changed. No curriculum is
offered to students.

Scope: the official CMA Intermediate syllabus (Papers 5 to 12, Groups I and II) and the December 2026 attempt, as a version-controlled
bundle in `supabase/curriculum/` for the existing importer. No schema change was needed.

## 1. Result in one paragraph

All eight papers of the **CMA Syllabus 2022 (Intermediate)** were transcribed from ICMAI's own documents: **2 groups, 8 papers, 29 sections,
74 modules, 90 published weightages**. The **December 2026** attempt is supported by an official ICMAI time table that explicitly schedules
the Intermediate papers "for Syllabus 2022" on **10 to 17 December 2026**. The bundle validates, generates deterministic SQL, imports
idempotently, and, in a throwaway test copy, passes the database readiness gate. It stays **draft** because verification must be done
by a person. The three title differences between the two official documents (section 5) were decided: the Full Version wording is kept.
It also records **45 official resources** (section 12) and proves a **staged, Group I first publication** (section 13).

## 1a. Decisions applied (review of 2026-11-08)

| # | Decision | What was done |
| --- | --- | --- |
| 1 | Keep the Full Version wording for the three titles | unchanged in the bundle; the conflicting per-paper PDF wording stays documented in section 5 and in the `sources.json` notes; no stable key changed |
| 2 | No topics table and no topic-level records | none added. Section maps to `syllabus_sections`, Module to `chapters`, numbered topic lines stay in the official PDFs. Topic tracking is deferred to a separate design proposal |
| 3 | Maintainer owns human verification; drafts stay drafts | every record is a draft; `verifiedAt` and `verifiedBy` are null everywhere; tests assert that a draft never carries a verifier and that no automated check marks anything published |
| 4 | Staged publication: Group I first, Group II later | new database test `scripts/db/test-staged-publication.sh` (section 13) |
| 5 | Official resources, with verified URLs, applicability and paper mapping | 44 resources added to the existing `study_resources` model (section 12); no schema change |
| 6 | Full validation, then a local draft-only commit | section 8; committed locally, not pushed |

## 2. Official sources used

Only ICMAI documents, each downloaded by hand from the official site (no crawler, no scheduled job, no AI ingestion) on 2026-11-08.
`sources.json` also records the SHA-256 of each downloaded syllabus and notice, the pages relied on, and where two documents disagree.

| Key | Title | Type | URL |
| --- | --- | --- | --- |
| `icmai-clarification-dec-2026-circular` | Clarification for the December 2026 term of Examination (Ref No. DoS-Academics/09/2026) | notification | <https://dwpivt501gtb6.cloudfront.net/upload/students/Circulars/Clarification_Dec2026_20260915142245.pdf> |
| `icmai-cma-syllabus-2022-full-version` | CMA Syllabus 2022 - Full Version | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/CMA_Syllabus2022_FV.pdf> |
| `icmai-cma-syllabus-2022-page` | CMA Syllabus 2022 | syllabus-page | <https://icmai.in/ClntStudents/CMASyllabus> |
| `icmai-exam-timetable-dec-2026` | Intermediate and Final Examination Time Table & Programme - December 2026 | timetable | <https://dwpivt501gtb6.cloudfront.net/upload/students/December_2026_Inter_Final_20260813143653.pdf> |
| `icmai-intermediate-curriculum-page` | Syllabus - 2022: Intermediate Course Curriculum | syllabus-page | <https://icmai.in/ClntStudents/Intermediate_Course_Curriculum> |
| `icmai-mcq-bank-intermediate-page` | MCQ Bank - Intermediate - Syllabus 2022 | resource-page | <https://icmai.in/ClntStudents/MCQBankPaper/3> |
| `icmai-mqp-page` | MQP - Intermediate - Syllabus 2022 (December 2026 Term) | resource-page | <https://icmai.in/ClntStudents/ClntMQPList> |
| `icmai-practice-test-papers-intermediate-page` | Practice Test Paper - Intermediate - Syllabus 2022 | resource-page | <https://icmai.in/ClntStudents/Practice_TestPaper/2> |
| `icmai-study-materials-intermediate-page` | Study Materials for Intermediate 2022 | resource-page | <https://icmai.in/ClntStudents/StudyMaterials/2> |
| `icmai-supplementary-current-term-page` | Supplementary - Syllabus 2022 (Supplementary for December 2026) | resource-page | <https://icmai.in/ClntStudents/Supplementary_currentterm> |
| `icmai-syllabus-2022-paper-05` | CMA Syllabus 2022 - Intermediate Course (Group - I) - Paper 5: Business Laws and Ethics (BLE) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P5.pdf> |
| `icmai-syllabus-2022-paper-06` | CMA Syllabus 2022 - Intermediate Course (Group - I) - Paper 6: Financial Accounting (FA) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P6.pdf> |
| `icmai-syllabus-2022-paper-07` | CMA Syllabus 2022 - Intermediate Course (Group - I) - Paper 7: Direct and Indirect Taxation (DITX) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P7.pdf> |
| `icmai-syllabus-2022-paper-08` | CMA Syllabus 2022 - Intermediate Course (Group - I) - Paper 8: Cost Accounting (CA) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P8.pdf> |
| `icmai-syllabus-2022-paper-09` | CMA Syllabus 2022 - Intermediate Course (Group - II) - Paper 9: Operations Management and Strategic Management (OMSM) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P9.pdf> |
| `icmai-syllabus-2022-paper-10` | CMA Syllabus 2022 - Intermediate Course (Group - II) - Paper 10: Corporate Accounting and Auditing (CAA) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P10.pdf> |
| `icmai-syllabus-2022-paper-11` | CMA Syllabus 2022 - Intermediate Course (Group - II) - Paper 11: Financial Management and Business Data Analytics (FMDA) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P11.pdf> |
| `icmai-syllabus-2022-paper-12` | CMA Syllabus 2022 - Intermediate Course (Group - II) - Paper 12: Management Accounting (MA) | syllabus | <https://dwpivt501gtb6.cloudfront.net/upload/students/Syllabus2022/Inter/P12.pdf> |
| `icmai-updates-announcements-page` | ICMAI Students - Update and Announcements | announcements-page | <https://icmai.in/ClntStudents/UpdateandAnnouncements> |

Which document supports what:

| Fact | Source |
| --- | --- |
| Groups and the eight paper titles | the Intermediate curriculum page, and Full Version p. 13 |
| Sections, modules, module numbers and weights | the per-paper PDF (page 1 table), cross-checked with the Full Version |
| Syllabus name, "effective from June 2023 term of examinations and onwards" | Full Version pp. 6, 8 and 13 |
| December 2026 dates, "Programme for Syllabus 2022", group-wise alternate days | the December 2026 time table |

## 3. Syllabus version and examination attempt

| Question | Answer | Evidence |
| --- | --- | --- |
| Which syllabus applies to December 2026? | **CMA Syllabus 2022** | the time table heads the Intermediate column "PROGRAMME FOR SYLLABUS 2022"; it lists no other Intermediate syllabus |
| When did it take effect? | "June 2023 term of examinations and onwards" | Full Version p. 13. That is a term, not a calendar date, so `effectiveFrom` is **null** (never guessed) |
| Exam attempt | December 2026, `dateStatus = official`, **2026-12-10 to 2026-12-17** | time table; Group I papers on 10, 12, 14, 16 December and Group II on 11, 13, 15, 17 December ("alternate dates for each group") |
| Attempt vs syllabus | kept separate: one syllabus bundle, one attempt record, one availability row | schema rule |
| Availability | **draft**. The evidence supports enabling it, but enabling is a verification act | see section 9 |

The time table carries no issue date (a timestamp appears only inside the file name, which I did not treat as a publication date), so
`publishedOn` is null for every source.

## 4. Coverage matrix

Counts are from the bundle. "Topic lines" are the numbered outline lines beneath each module (for example 2.1, 2.2); they are an
approximate regular-expression count, shown for scale only, and are **not stored** (section 6).

| Paper | Group | Official title | Sections | Modules | Section weights | Own module weights | Official source | Topic lines | Hierarchy | Publication |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | I | Business Laws and Ethics (BLE) | 4 | 13 | 4/4 | 7/13 | 3 pp. (Full Version pp. 28-30) | ~52 | Complete, machine-verified | Draft |
| 6 | I | Financial Accounting (FA) | 6 | 9 | 6/6 | 5/9 | 3 pp. (Full Version pp. 31-33) | ~21 | Complete, machine-verified | Draft |
| 7 | I | Direct and Indirect Taxation (DITX) | 2 | 6 | 2/2 | 6/6 | 2 pp. (Full Version pp. 34-35) | ~34 | Complete, machine-verified | Draft |
| 8 | I | Cost Accounting (CA) | 3 | 6 | 3/3 | 6/6 | 2 pp. (Full Version pp. 36-37) | ~20 | Complete, machine-verified | Draft |
| 9 | II | Operations Management and Strategic Management (OMSM) | 2 | 11 | 2/2 | 11/11 | 3 pp. (Full Version pp. 38-40) | ~66 | Complete, machine-verified | Draft |
| 10 | II | Corporate Accounting and Auditing (CAA) | 2 | 8 | 2/2 | 8/8 | 2 pp. (Full Version pp. 41-42) | ~27 | Complete, machine-verified | Draft |
| 11 | II | Financial Management and Business Data Analytics (FMDA) | 2 | 11 | 2/2 | 11/11 | 4 pp. (Full Version pp. 43-46) | ~47 | Complete, machine-verified | Draft |
| 12 | II | Management Accounting (MA) | 8 | 10 | 8/8 | 7/10 | 3 pp. (Full Version pp. 47-49) | ~50 | Complete, machine-verified | Draft |

Totals: **Group I** 4 papers, 15 sections, 34 modules; **Group II** 4 papers, 14 sections, 40 modules.

**Weightages.** Every section has its published weight, and each paper's section weights add up to 100. Of the 74 modules, **61** have
their own published weight. **13 modules publish no individual weight**, because the syllabus table shows one merged cell for a group of
modules. I confirmed this twice: arithmetically, and from the PDF layout, where each merged weight sits exactly at the vertical midpoint
of the rows it spans.

| Paper | Modules sharing one merged weight | Shared weight |
| --- | --- | --- |
| 5 | 5 and 6 | 5% |
| 5 | 7, 8, 9 and 10 | 10% |
| 6 | 5, 6, 7 and 8 | 15% |
| 12 | 3, 4 and 5 | 30% |

For these, only the section weight is stored. Nothing is divided or estimated. No range is published anywhere, so each weight is stored
with `min = max` and its label exactly as printed (for example `30%`).

## 5. Discrepancies and ambiguities (title choices decided)

The two official documents agree to 99.1% by text comparison. The differences that touch a record I store are these three. I chose the
**Full Version** wording because it is internally consistent in each case. **The maintainer approved this on 2026-11-08**; the per-paper
PDF wording is preserved in this table and in the source notes so a reviewer can see exactly what differs.

| Where | Per-paper PDF says | Full Version says | Bundle uses |
| --- | --- | --- | --- |
| Paper 6, Section D (and Module 4 in its summary table) | "Partnership Accounts" (its own module heading says "Partnership Accounting") | "Partnership Accounting" everywhere | **Partnership Accounting** |
| Paper 7, Module 6 | "Customs Act" | "Customs Act & Rules" | **Customs Act & Rules** |
| Paper 11, Module 7 | "Financing Decision of a Firm" (its own body says "Decisions") | "Financing Decisions of a Firm" | **Financing Decisions of a Firm** |

Smaller points, none changing a stored record:

- Paper 10, Module 2: "As Per Schedule III" in the table, "As per" in the body (capitalisation only). The table form is used.
- Topic-level wording differs in a few places (Paper 11 topic numbering, "4.1.3" against "4.2"; Paper 11 topics 11.1 and 11.2; Paper 5 topic 6.1;
  Paper 8 topic 2.3.2; Paper 8 topic 6.1.3). Topics are not stored, so this affects nothing today, but it will matter if topics are ever modelled.
- Spelling (organisation or organization, accounts or accounting) is inconsistent inside ICMAI's own documents.

## 6. Mapping decisions

| Decision | Reason |
| --- | --- |
| The official **Section** maps to a section; the official **Module** maps to a chapter, and its module number is the official label | the syllabus is Section, then Module, then topic lines. A module is the unit a student studies and tracks; it matches the schema without inventing anything |
| **Topic lines are not stored** | the approved schema has no topic table, and adding one is a design change I will not make unasked. They stay in the PDFs. If you want topic-level tracking, that is a separate proposal |
| Sections are `Section A`, `Section B`... as printed; **modules are labelled "1", "2"...** as printed under "Module No." | exactly as published |
| A section containing one module (for example Paper 6 Section A) keeps both rows | the official table has both. Neither is artificial |
| Weightages are recorded at the level, and in the wording, where ICMAI prints them | no spreading, no derivation |
| Group names "Group I" and "Group II" | the documents print "GROUP - I", "Group - I" and "GROUP-I"; I normalised the hyphen only |
| Paper names in title case; short names are the official abbreviations (BLE, FA, DITX, CA, OMSM, CAA, FMDA, MA) | the headings print them in capitals with the abbreviation in brackets |
| Course name "CMA Intermediate", level order 2 | the Full Version prints "INTERMEDIATE COURSE" between Foundation and Final |
| Stable keys are title-derived and frozen (`ble-c-indian-contracts-act-1872`, `ble-s-industrial-laws`) | schema rule. One very long title (Paper 6 Module 3) got a shortened key, because keys are identifiers, not display text |
| Two modules titled "Introduction" (Paper 9, Modules 1 and 8) get section-qualified keys | keys must be unique |
| **No official identifiers exist** in the syllabus beyond the numbering, so none are recorded | |
| The app's sample outline in `src/data/subjects.ts` was **not** used | it is marked as sample data |

## 7. What I left empty on purpose

| Field | Why |
| --- | --- |
| `syllabus.effectiveFrom` | the source gives a term, not a date |
| `suggestedStudyHours` on every module | an app planning aid, not an official figure |
| `verifiedAt`, `verifiedBy` on every record | only a person can verify (section 9) |
| `publishedOn` on every source | none of the documents states an issue date |
| Resource term where no official document states one | study notes for Papers 9, 11 and 12, and every MCQ bank, carry no term and no attempt (section 12) |
| Practice test papers tied to December 2026 | none exist; the ones published are June 2026 and keep that term |
| Previous question papers | not recorded (the page was not part of this update) |
| Final course resources | not part of M5 (the supplementary page also lists Final papers 13, 15, 17, 18, 19; not recorded) |

## 8. Test results

| Check | Result |
| --- | --- |
| Bundle validator | valid: 74 chapters, 29 sections, 90 weightages, 45 resources |
| SQL generation (existing CLI), run twice | 1,847 lines, **byte-identical** on the second run (SHA-256 `b683001a0a5a9b27a541a6c050af7d01fe9a40122ac28ad9b61547ecf9104298`), no `DELETE`, `TRUNCATE` or `DROP`, no personal table |
| The fake bundle is still refused | exit 3, no file written |
| Independent text check against the PDFs | every one of the 29 section and 74 module titles and weights matches the per-paper PDF and the Full Version, **except exactly the three differences in section 5** |
| Importer unit tests | pass |
| Importer integration test (fake fixture, rolled back) | passes |
| **Real-bundle database test** (`scripts/db/test-real-bundle.sh`, new, rolled back) | passes: imports as drafts; `csv_is_ready` is false; students are offered nothing; nobody is recorded as verifier; no hours invented; the December 2026 dates are stored; re-import is idempotent with unchanged ids; a **test-only published copy** passes the readiness gate and is offered as "CMA Intermediate / CMA Syllabus 2022 / December 2026" with both groups; importing the draft file over it does not downgrade or un-verify; removing a module retires it and deletes nothing, with a stand-in student reference intact; a published paper with no published module is refused by the database and leaves nothing behind |
| **Staged-publication database test** (`scripts/db/test-staged-publication.sh`, new, rolled back) | passes (section 13) |
| Real-bundle Vitest (`scripts/curriculum/real-bundle.test.ts`, new, 24 tests) | pass: counts, official order, weight sums, no weight on a merged cell, nothing invented, honest verification fields, source hosts, publish-gate simulation, safe deterministic SQL, a **golden outline** and a **golden resource listing**, so any edit to a title, order, weight, URL or applicability is a deliberate change, and the resource rules in section 12 |
| Existing pgTAP | 789 assertions in 20 files, all pass |
| Committed-behaviour script (quota races, enrolment flows) | passes |
| Vitest (all) | **327 tests pass** (was 303 before M5) |
| TypeScript, ESLint, production build | clean |
| Secret guard (repository and bundle) | clean (230 files) |
| `supabase db lint --schema public` | no schema errors |
| `src/` changed? | **no** |
| `seed.sql` still empty? | **yes** (comments only, no statements) |
| Fake fixture kept out of migrations and seed | yes (the existing leak checks pass; `seed.sql` is still empty) |

**Sabotage testing of the new checks.** I deliberately corrupted the bundle in 25 ways (a weight, a section weight, a title typo in a
module and in a section, a renumbered module, two swapped modules, a removed module, a module moved to another section, an invented
effective date, a moved exam date, invented study hours, a draft claiming a verifier, a "published" record by a bot or with no verifier, a
weight added to a merged-cell module, a removed weight, a non-ICMAI source host, a record citing the wrong paper's source, a renamed group,
a changed paper number, a paper in the wrong group, a FAKE marker, an enabled availability, and a reverted title choice). **All 25 were caught.** A second round of 12 sabotage cases against the resource rules (a practice paper tied to December 2026 or relabelled as a December term, study notes tied without evidence, a non-ICMAI host, a one-character URL change, an invented Paper 5 model paper, an invented Paper 8 supplementary, an MCQ bank given a term, a draft resource claiming a verifier, a removed resource, an invented source date, a changed circular date) was **also fully caught (12 of 12)**.
My first attempt at this found that more than half of my cases silently failed to apply (they tested nothing), so I rewrote them against the
parsed JSON.

Database breaks run against the staged-publication test: `create_enrollment` no longer requiring published groups (caught), `enrollment_options` listing draft groups (caught), and a changed bundle weight (caught, by the golden outline comparison). `csv_is_ready` forced to true was **not** caught here, by design: this test never contains a not-ready scenario, and that gate is asserted by the real-bundle test and pgTAP.

Database breaks run against the real-bundle test: `csv_is_ready` forced true (caught), the view ignoring availability status (caught), and the
publish-gate trigger dropped (**not caught by this test, caught by the existing pgTAP suite**, which is where that trigger is covered). The
earlier M1/M2 and M3 mutation sweeps were re-run on the final schema at the end of M3 (75 of 75 caught, plus 26 of 26 for the quota, deletion and date protections).

## 9. Records intentionally left unpublished, and what a human must do

**All of them**: 1 course, 1 syllabus version, 1 course-syllabus link, 1 attempt, 1 availability row, 2 groups, 8 papers, 29 sections,
74 modules, 90 weightages and 45 resources. The database will not offer the course until every published paper has a published module and
the verification fields are filled in.

Required before publication (`docs/architecture/curriculum-seeding.md` section 8):

1. ~~Decide the three title differences~~ (done: Full Version wording). A reviewer should still confirm them against the PDFs.
2. **Second pass by a person**, preferably on a different day: compare the outline in appendix A with the ICMAI PDFs, record by record
   (names, numbering, order, section membership, weights). The appendix is generated from the bundle for exactly this purpose.
3. Confirm the December 2026 time table is still the current one on the ICMAI site, then confirm the attempt and availability.
4. The reviewer sets `status`, `verifiedAt` and `verifiedBy` (their own GitHub handle) on what they checked. I will not fill in `verifiedBy`.
5. **Publish Group I first**: set the records of Group I (the group, its four papers, their sections, modules and weightages, plus the course,
   syllabus, link and attempt) to published with the reviewer's handle, check the published hierarchy against the golden outline, and only then
   enable the December 2026 availability. Group II follows when its own pass is complete (section 13).
6. For each resource, a person opens the link, confirms it is current for the attempt, and only then verifies it (section 12).
7. Pull request review, then the maintainer generates the SQL and applies it by hand to the hosted project, after a backup, with MFA.

Time matters: the first paper is on 10 December 2026, about a month from today.

## 10. Remaining questions and human review requirements

Settled in the review: the three titles, no topics table, maintainer-led verification, staged publication, resource scope.

Still open:

1. **The reviewer's GitHub handle** to record as `verifiedBy` is theirs to enter, never mine. Nothing is verified until they do.
2. **Papers 8 and 10 supplementary.** The circular's rows for Paper 8 (CAS 1 to 24) and Paper 10 (Companies Rules 2014) refer to supplementary
   material, but the December 2026 supplementary page lists only Papers 5, 6, 7A and 7B. Re-check the ICMAI page before publishing; I did not
   assume a file exists.
3. **Model papers for Papers 5 and 9** are not on ICMAI's December 2026 list yet. They can be added later as ordinary resource records.
4. **Practice test papers are June 2026.** They are recorded with that term and tied to no attempt. Confirm that showing them is acceptable, or leave them out of the first publication.
5. **The "Online MCQ Portal"** (`learncma.in`) is linked from ICMAI's site but is a different domain; it is not recorded.
6. A hosted import needs a pinned hosted Postgres version and a backup; both stay with the maintainer.

## 11. Files

| File | Purpose |
| --- | --- |
| `supabase/curriculum/bundles/cma-intermediate-2022/` (`bundle`, `structure`, `weightages`, `resources`, `availability`) | the bundle |
| `supabase/curriculum/shared/sources.json`, `attempts.json` | sources and the December 2026 attempt |
| `supabase/curriculum/README.md` | provenance, status and rules |
| `scripts/curriculum/outline.ts`, `real-bundle.test.ts`, `__fixtures__/real-bundle-outline.txt` | the review outline, its golden test and the data checks |
| `scripts/db/build-real-bundle-test-sql.ts`, `test-real-bundle.sh`, `test-staged-publication.sh` | the real-bundle and staged-publication database tests |
| `scripts/curriculum/__fixtures__/real-bundle-resources.txt` | the reviewed resource listing (golden) |
| `.github/workflows/database.yml` | runs the two new database tests; **fixes a latent bug**: the "validate every real bundle" step never passed `--shared`, so the first real bundle would have failed CI |
| `supabase/README.md` | updated status, layout and commands |
| `docs/architecture/m5-curriculum-review.md` | this document |
| `docs/architecture/m3-m4-review.md` | corrected an earlier wrong number (75 runs, not 98) |

## 12. Resources: provenance and applicability

Every link was read from a **live official ICMAI page** on 2026-11-08, then each document was downloaded and its first pages read, so
that the URL, the paper, the syllabus and (where it states one) the term are *verified*, not assumed. All 44 returned `200` and a real PDF
(the study notes are copy-protected PDFs that open without a password). `linkStatus` is `active`, `lastCheckedAt` is 2026-11-08, and every
resource is a **draft**.

Links that a search engine suggested but the site no longer serves were **not** recorded: `MCQBankIntermediate`, `Intermediate_Study_Materials`
and `CMA_Intermediatejune2026` all returned 404 today, and the model-paper page that search showed was titled for the June 2025 term.

| Category | Count | Syllabus | Term | Tied to December 2026? | Evidence |
| --- | --- | --- | --- | --- | --- |
| Study notes | 9 | 2022 (title page) | not stated on the page or the PDF | **only Papers 5, 6, 7A, 7B, 8, 10** | the 15/09/2026 circular names the Paper 8 and 10 files and points to the Study Materials page for Papers 5, 6 and 7 |
| Supplementary for December 2026 | 4 (Papers 5, 6, 7A, 7B) | 2022 | December 2026 (PDF header) | yes | each PDF is headed "Supplementary for December 2026 term of examination" |
| Model question papers, Set 1 | 6 (Papers 6, 7, 8, 10, 11, 12) | 2022 | December 2026 (PDF header) | yes | **Papers 5 and 9 are not published** |
| MCQ banks | 8 (Papers 5 to 12) | 2022 (page label) | none stated | no | the PDFs carry no title; paper mapping confirmed from the questions |
| Practice test papers | 16 (question and answers, Papers 5 to 12) | 2022 | **June 2026** (PDF header) | **no** | no December 2026 set exists |
| Circular | 1 | 2022 | December 2026 | yes | Ref No. DoS-Academics/09/2026, dated 15/09/2026 (the only dated source) |
| Time table | 1 | 2022 | December 2026 | yes | section 3 |

**Supplementary material stays a resource.** It is recorded as `study_material` resources scoped to the paper and the attempt. It is not a
paper, a section or a chapter, and a test asserts the paper, module and section counts are unchanged. Papers 7A and 7B are the two halves of
Paper 7 and are scoped to the one subject.

**What the circular establishes.** For the December 2026 term under Syllabus 2022, the Companies Act 2013, the Cost Records and Audit Rules,
CAS 1 to 24, the Finance Act 2025, GST and the specified Ind AS are each examined **as amended up to 31 May 2026**. Several study notes
were last printed before that date (for example Paper 10, "Reprint: January 2026"), which is why the supplementaries matter.

**Open points** (also in section 10): the circular mentions supplementary material for Papers 8 and 10 that the supplementary page does not
list; Papers 5 and 9 have no December 2026 model paper yet; practice papers are June 2026 documents.

**Provenance of each document** (the URLs are in `scripts/curriculum/__fixtures__/real-bundle-resources.txt`, the reviewed golden listing):

**Study notes (Syllabus 2022)**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `sm-p05` | 508 | `91c62c360e9d14bd` | title page "Study Notes SYLLABUS 2022" |
| `sm-p06` | 664 | `d82945eeea4613dd` | title page "Study Notes SYLLABUS 2022" |
| `sm-p07a` | 596 | `800b2d3dd51480fb` | title page "Study Notes SYLLABUS 2022" |
| `sm-p07b` | 404 | `9d20909662b4a84b` | title page "Study Notes SYLLABUS 2022" |
| `sm-p08` | 596 | `e95b519b3d36de92` | title page "Study Notes SYLLABUS 2022" |
| `sm-p09` | 576 | `2b6d02af30db353f` | title page "Study Notes SYLLABUS 2022" |
| `sm-p10` | 746 | `2e86de4f352853de` | title page "Study Notes SYLLABUS 2022" |
| `sm-p11` | 660 | `0c7b0613c15f0385` | title page "Study Notes SYLLABUS 2022" |
| `sm-p12` | 604 | `70b5e66fd4035ce2` | title page "Study Notes SYLLABUS 2022" |

**Supplementary for December 2026**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `supp-dec2026-p05` | 8 | `fbc97dc2f02ff1a4` | header "SUPPLEMENTARY FOR DECEMBER 2026 TERM OF EXAMINATION" |
| `supp-dec2026-p06` | 3 | `5be12932c517ac2c` | header "SUPPLEMENTARY FOR DECEMBER 2026 TERM OF EXAMINATION" |
| `supp-dec2026-p07a` | 2 | `92e452e0cca6b3dc` | header "SUPPLEMENTARY FOR DECEMBER 2026 TERM OF EXAMINATION" |
| `supp-dec2026-p07b` | 2 | `01dcd5fdef531980` | header "SUPPLEMENTARY FOR DECEMBER 2026 TERM OF EXAMINATION" |

**Model question papers, December 2026, Set 1**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `mqp-dec2026-p06` | 7 | `db920fceb63bcfbc` | header "MODEL QUESTION PAPER TERM - DECEMBER 2026 ... SYLLABUS 2022" |
| `mqp-dec2026-p07` | 8 | `d5c44d937445a0e6` | header "MODEL QUESTION PAPER TERM - DECEMBER 2026 ... SYLLABUS 2022" |
| `mqp-dec2026-p08` | 7 | `6e2599090540a90e` | header "MODEL QUESTION PAPER TERM - DECEMBER 2026 ... SYLLABUS 2022" |
| `mqp-dec2026-p10` | 5 | `897aef6985d08772` | header "MODEL QUESTION PAPER TERM - DECEMBER 2026 ... SYLLABUS 2022" |
| `mqp-dec2026-p11` | 6 | `ced73936b07eed74` | header "MODEL QUESTION PAPER TERM - DECEMBER 2026 ... SYLLABUS 2022" |
| `mqp-dec2026-p12` | 10 | `54ceef150a8c40a2` | header "MODEL QUESTION PAPER TERM - DECEMBER 2026 ... SYLLABUS 2022" |

**MCQ banks**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `mcq-p05` | 40 | `93364cd6f631a06e` | content matches the paper (page label only) |
| `mcq-p06` | 21 | `828ea7aae01649c5` | content matches the paper (page label only) |
| `mcq-p07` | 33 | `c6ad5f27eb379912` | content matches the paper (page label only) |
| `mcq-p08` | 48 | `7a5451b7a1d474b4` | content matches the paper (page label only) |
| `mcq-p09` | 47 | `1b6a80975c018156` | content matches the paper (page label only) |
| `mcq-p10` | 35 | `1a41fc20eb85ca68` | content matches the paper (page label only) |
| `mcq-p11` | 19 | `61de70ed62e19647` | content matches the paper (page label only) |
| `mcq-p12` | 41 | `86cd93e6481eab9c` | content matches the paper (page label only) |

**Practice test papers (question)**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `ptp-jun2026-p05-questions` | 4 | `c633f10a367c3cb0` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p06-questions` | 8 | `f48abfdb2c75fedd` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p07-questions` | 8 | `765ccfd12182c8f3` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p08-questions` | 7 | `2dce2b4aadd93ce1` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p09-questions` | 5 | `5fae712b9297cc62` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p10-questions` | 5 | `3b498554f753c9f3` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p11-questions` | 7 | `17ee0e1198646630` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p12-questions` | 8 | `fa9ec710a63bf8a4` | header "PRACTICE TEST PAPER TERM - JUNE 2026" |

**Practice test papers (answers)**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `ptp-jun2026-p05-answers` | 11 | `5999efe991b98965` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p06-answers` | 18 | `3cf8ed0535d1902c` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p07-answers` | 15 | `65a0c6b5a37022fd` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p08-answers` | 20 | `81bd07f6dae13fd9` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p09-answers` | 22 | `a92950736ae5889a` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p10-answers` | 14 | `ae8648b45b10874b` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p11-answers` | 17 | `91f6bcdf088a2580` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |
| `ptp-jun2026-p12-answers` | 19 | `ec9177b16c56728d` | header "ANSWERS TO PRACTICE TEST PAPER TERM - JUNE 2026" |

**Circular**

| Resource | Pages | SHA-256 (first 16) | What the document itself says |
| --- | --- | --- | --- |
| `notice-dec2026-clarification-circular` | 3 | `e505dd6f7b4d191f` | Ref No. DoS-Academics/09/2026, dated 15/09/2026 |

## 13. Staged publication (Group I first, Group II later)

`scripts/db/test-staged-publication.sh` (new, rolled back, local database only, test-only verifier, nothing written to the repository)
imports four states of the real bundle in one transaction and checks each:

| Stage | State | What is asserted |
| --- | --- | --- |
| 1 | Group I's whole hierarchy and weightages published, availability **still a draft** | the published hierarchy in the database **equals the golden outline for Group I exactly**, before availability is enabled; 34 modules published, Group II's 40 untouched drafts; the readiness gate passes; nothing is offered; a signed-in student cannot enrol |
| 2 | availability enabled, Group I only | the course and December 2026 attempt are offered with **Group I only**; Group II is **not** returned by `enrollment_options`; a student can enrol in Group I, **cannot** enrol in the draft Group II, nor in both |
| 3 | Group II published | **no id or stable key of any group, paper, section, module or weightage changed**, and no row was added or removed (74 modules, 8 papers, 90 weightages); the full hierarchy equals the whole golden outline; **both groups are returned, in order**; a student can now enrol in Group II alone, in both, and add Group II to an existing Group I enrolment |

Real students are simulated by calling `create_enrollment` and `set_enrollment_groups` as the `authenticated` role, so "selectable" is proved
by behaviour as well as by the view.

## Appendix A: the reviewed outline (second-pass checklist)

Generated from the bundle. "[no individual weight published]" marks the 13 merged-cell modules.

```text
Group I
  Paper 5: Business Laws and Ethics (BLE)
    Section A: Commercial Laws [30%]
      1. Introduction to Law and Legal System in India [5%]
      2. Indian Contracts Act, 1872 [10%]
      3. Sale of Goods Act, 1930 [5%]
      4. Negotiable Instruments Act, 1881 [5%]
      5. Indian Partnership Act, 1932 [no individual weight published]
      6. Limited Liability Partnership Act, 2008 [no individual weight published]
    Section B: Industrial Laws [15%]
      7. Factories Act, 1948 [no individual weight published]
      8. Payment of Gratuity Act, 1972 [no individual weight published]
      9. Employees Provident Fund and Miscellaneous Provisions Act, 1952 [no individual weight published]
      10. Employees State Insurance Act, 1948 [no individual weight published]
      11. The Code on Wages, 2019 [5%]
    Section C: Corporate Laws [40%]
      12. Companies Act, 2013 [40%]
    Section D: Business Ethics [15%]
      13. Business Ethics and Emotional Intelligence [15%]
  Paper 6: Financial Accounting (FA)
    Section A: Accounting Fundamentals [15%]
      1. Accounting Fundamentals [15%]
    Section B: Accounting for Special Transactions [10%]
      2. Bills of Exchange, Consignment, Joint Venture [10%]
    Section C: Preparation of Financial Statements [20%]
      3. Preparation of Final Accounts of Commercial Organisations, Not-for-Profit Organisations and from Incomplete Records [20%]
    Section D: Partnership Accounting [20%]
      4. Partnership Accounting [20%]
    Section E: Lease, Branch and Departmental Accounts etc. [15%]
      5. Lease Accounting [no individual weight published]
      6. Branch (including Foreign Branch) and Departmental Accounts [no individual weight published]
      7. Insurance Claim for Loss of Stock and Loss of Profit [no individual weight published]
      8. Hire Purchase and Installment Sale Transactions [no individual weight published]
    Section F: Accounting Standards [20%]
      9. Accounting Standards [20%]
  Paper 7: Direct and Indirect Taxation (DITX)
    Section A: Direct Taxation [50%]
      1. Basics of Income Tax Act [10%]
      2. Heads of Income [25%]
      3. Total Income and Tax Liability of Individuals & HUF [15%]
    Section B: Indirect Taxation [50%]
      4. Concept of Indirect Taxes [5%]
      5. Goods and Services Tax (GST) Laws [35%]
      6. Customs Act & Rules [10%]
  Paper 8: Cost Accounting (CA)
    Section A: Introduction to Cost Accounting [40%]
      1. Introduction to Cost Accounting [5%]
      2. Cost Ascertainment – Elements of Cost [15%]
      3. Cost Accounting Standards (CAS 1 to CAS 24) [10%]
      4. Cost Book Keeping [10%]
    Section B: Methods of Costing [30%]
      5. Methods of Costing [30%]
    Section C: Cost Accounting Techniques [30%]
      6. Cost Accounting Techniques [30%]
Group II
  Paper 9: Operations Management and Strategic Management (OMSM)
    Section A: Operations Management [60%]
      1. Introduction [5%]
      2. Operations Planning [5%]
      3. Designing of Operational Systems and Control [5%]
      4. Application of Operation Research - Production Planning and Control [20%]
      5. Productivity Management and Quality Management [5%]
      6. Project Management, Monitoring and Control [15%]
      7. Economics of Maintenance and Spares Management [5%]
    Section B: Strategic Management [40%]
      8. Introduction [10%]
      9. Strategic Analysis and Strategic Planning [10%]
      10. Formulation and Implementation of Strategy [10%]
      11. Digital Strategy [10%]
  Paper 10: Corporate Accounting and Auditing (CAA)
    Section A: Corporate Accounting [50%]
      1. Accounting for Shares and Debentures [10%]
      2. Preparation of the Statement of Profit and Loss and Balance Sheet (As Per Schedule III of Companies Act, 2013) [10%]
      3. Cash Flow Statement [10%]
      4. Accounts of Banking, Electricity and Insurance Companies [10%]
      5. Accounting Standards [10%]
    Section B: Auditing [50%]
      6. Basic Concepts of Auditing [10%]
      7. Provisions Relating to Audit under Companies Act, 2013 [30%]
      8. Auditing of Different Types of Undertakings [10%]
  Paper 11: Financial Management and Business Data Analytics (FMDA)
    Section A: Financial Management [80%]
      1. Fundamentals of Financial Management [5%]
      2. Institutions and Instruments in Financial Markets [10%]
      3. Tools for Financial Analyses [15%]
      4. Sources of Finance and Cost of Capital [10%]
      5. Capital Budgeting [15%]
      6. Working Capital Management [15%]
      7. Financing Decisions of a Firm [10%]
    Section B: Business Data Analytics [20%]
      8. Introduction to Data Science for Business Decision-making [5%]
      9. Data Processing, Organisation, Cleaning and Validation [5%]
      10. Data Presentation: Visualisation and Graphical Presentation [5%]
      11. Data Analysis and Modelling [5%]
  Paper 12: Management Accounting (MA)
    Section A: Introduction to Management Accounting [5%]
      1. Introduction to Management Accounting [5%]
    Section B: Activity Based Costing [10%]
      2. Activity Based Costing [10%]
    Section C: Decision Making Tools [30%]
      3. Marginal Costing [no individual weight published]
      4. Applications of Marginal Costing in Short Term Decision Making [no individual weight published]
      5. Transfer Pricing [no individual weight published]
    Section D: Standard Costing and Variance Analysis [15%]
      6. Standard Costing and Variance Analysis [15%]
    Section E: Forecasting, Budgeting and Budgetary Control [15%]
      7. Forecasting, Budgeting and Budgetary Control [15%]
    Section F: Divisional Performance Measurement [10%]
      8. Divisional Performance Measurement [10%]
    Section G: Responsibility Accounting [5%]
      9. Responsibility Accounting [5%]
    Section H: Decision Theory [10%]
      10. Decision Theory [10%]
```
