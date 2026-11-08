# Curriculum bundles

The version-controlled source of truth for the shared curriculum. The database is a deployed copy of these files.
Format and rules: `docs/architecture/curriculum-seeding.md`. Review package for the current bundle:
`docs/architecture/m5-curriculum-review.md`.

```text
shared/
  sources.json        every official document a record cites (title, URL, retrieval date, file hash, page notes)
  attempts.json       exam attempts (December 2026, with the dates the official time table publishes)
bundles/
  cma-intermediate-2022/
    bundle.json       course, syllabus version and their link
    structure.json    groups, papers, sections, modules (stored as chapters)
    weightages.json   only the weightages ICMAI publishes, at the level it publishes them
    resources.json    official links: time table, circular, study notes, supplementaries, model papers, MCQ banks, practice papers
    availability.json which attempts the course and syllabus is offered in
```

## Status of `cma-intermediate-2022`

**Every record is a `draft`, with no verifier.** The structure was transcribed from the official ICMAI syllabus and checked
against it by machine and by geometry, but only a person can verify it. Nothing here is offered to students until a designated
reviewer completes the second pass and sets `status`, `verifiedAt` and `verifiedBy` on the records they checked
(`docs/architecture/curriculum-seeding.md` section 8). Never set `verifiedBy` on someone else's behalf.

## Publication is staged

Group I is published first, then Group II. `scripts/db/test-staged-publication.sh` proves the sequence on a throwaway database:
the published hierarchy must equal the reviewed golden outline (`scripts/curriculum/__fixtures__/real-bundle-outline.txt`) before
availability is enabled; Group II stays a draft and is not offered until it is published; and publishing it later changes no id or
stable key. Resources are tied to the December 2026 attempt only where an official document says they apply
(`__fixtures__/real-bundle-resources.txt` is the reviewed listing).

## Rules

- Never rename or reuse a `stableKey`. Order lives in `sequenceNo` and `sortOrder`, never in the key.
- Titles and numbering are copied as the official document prints them. Where two official documents differ, the choice is
  recorded in the review document, not made silently.
- A weightage is stored only where ICMAI publishes it for that exact item. Percentages are never spread across modules.
- Generate SQL with `npm run curriculum:sql -- supabase/curriculum/bundles/<name> --shared supabase/curriculum/shared --out <file>`.
  Generated SQL is not committed and is applied to a hosted project only by the maintainer, by hand, after a backup.
- The fake fixture lives in `scripts/curriculum/__fixtures__/` and never here.
