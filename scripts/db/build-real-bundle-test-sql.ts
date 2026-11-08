/**
 * Builds the SQL files used by scripts/db/test-real-bundle.sh from the REAL curriculum bundle.
 *
 *   draft.sql              the bundle exactly as committed (every record a draft)
 *   published.sql          a TEST-ONLY copy with everything marked published, to prove the readiness gate would pass.
 *                          Its verifier is the obviously non-human handle below. It is applied only inside a transaction
 *                          the test rolls back, and is never written into the repository.
 *   published-minus-one.sql  the same, with one chapter removed from the syllabus (it must be retired, never deleted)
 *   bad-group-without-chapters.sql  published, but every chapter of one paper is a draft (the database must refuse)
 *   g1-hierarchy.sql       STAGED: only Group I (and its whole hierarchy and weightages) published; availability still a draft
 *   g1-enabled.sql         STAGED: the same, with the December 2026 availability enabled
 *   g1-g2-enabled.sql      STAGED: Group II published as well (identical to published.sql apart from the version)
 *   golden-g1.txt, golden-g2.txt, golden-all.txt   slices of the reviewed outline the database is compared with
 * All files are written without BEGIN/COMMIT so the test controls the transaction.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashBundle, loadBundle } from '../curriculum/bundle-io.ts';
import { generateSql } from '../curriculum/generate-sql.ts';
import type { Bundle } from '../curriculum/types.ts';
import { validateBundle } from '../curriculum/validate.ts';

export const TEST_VERIFIER = 'm5-test-only';
const out = resolve(process.argv[2] ?? 'tmp-real-bundle-test');
const bundleDir = resolve('supabase/curriculum/bundles/cma-intermediate-2022');
const sharedDir = resolve('supabase/curriculum/shared');
const load = (): Bundle => loadBundle(bundleDir, sharedDir);
const write = (name: string, bundle: Bundle) => {
  writeFileSync(resolve(out, name), generateSql(bundle, { contentSha256: hashBundle(bundle), transaction: false, allowRetireAll: false }));
};

/** Marks every record published, with a test-only verifier. Used only for the throwaway test copies. */
export function publishForTest(bundle: Bundle, today: string): Bundle {
  const stamp = <T extends { status?: string; verifiedAt?: string | null; verifiedBy?: string | null }>(record: T) => {
    record.status = 'published';
    record.verifiedAt = today;
    record.verifiedBy = TEST_VERIFIER;
  };
  stamp(bundle.meta.course);
  stamp(bundle.meta.syllabus);
  stamp(bundle.meta.courseSyllabus);
  [...bundle.attempts, ...bundle.groups, ...bundle.subjects, ...bundle.sections, ...bundle.chapters, ...bundle.weightages, ...bundle.resources].forEach(stamp);
  bundle.availability.forEach((a) => {
    a.status = 'enabled';
    a.verifiedAt = today;
    a.verifiedBy = TEST_VERIFIER;
  });
  return bundle;
}

/** Publishes exactly one group's complete hierarchy (and the weightages on it), plus the course, syllabus and attempt. */
export function publishGroupForTest(bundle: Bundle, groupKey: string, today: string, enableAvailability: boolean): Bundle {
  const stamp = <T extends { status?: string; verifiedAt?: string | null; verifiedBy?: string | null }>(record: T) => {
    record.status = 'published';
    record.verifiedAt = today;
    record.verifiedBy = TEST_VERIFIER;
  };
  stamp(bundle.meta.course);
  stamp(bundle.meta.syllabus);
  stamp(bundle.meta.courseSyllabus);
  bundle.attempts.forEach(stamp);
  const subjects = bundle.subjects.filter((s) => s.group === groupKey);
  const subjectKeys = new Set(subjects.map((s) => s.stableKey));
  const sections = bundle.sections.filter((s) => subjectKeys.has(s.subject));
  const chapters = bundle.chapters.filter((c) => subjectKeys.has(c.subject));
  const targets = new Set([...subjects, ...sections, ...chapters].map((r) => r.stableKey));
  stamp(bundle.groups.find((g) => g.stableKey === groupKey)!);
  [...subjects, ...sections, ...chapters].forEach(stamp);
  bundle.weightages.filter((w) => targets.has(w.target)).forEach(stamp);
  bundle.availability.forEach((a) => {
    a.status = enableAvailability ? 'enabled' : 'draft';
    a.verifiedAt = enableAvailability ? today : null;
    a.verifiedBy = enableAvailability ? TEST_VERIFIER : null;
  });
  return bundle;
}

const today = new Date().toISOString().slice(0, 10);
mkdirSync(out, { recursive: true });

const draft = load();
const draftProblems = validateBundle(draft, { today });
if (draftProblems.length > 0) {
  console.error('the real bundle is invalid:', draftProblems);
  process.exit(1);
}
write('draft.sql', draft);

const published = publishForTest(load(), today);
const publishedProblems = validateBundle(published, { today });
if (publishedProblems.length > 0) {
  console.error('the published test copy is invalid:', publishedProblems);
  process.exit(1);
}
write('published.sql', published);

const minusOne = publishForTest(load(), today);
minusOne.meta.bundleVersion = '2';
const removed = minusOne.chapters.find((c) => c.stableKey === 'ble-c-factories-act-1948');
if (!removed) throw new Error('expected chapter ble-c-factories-act-1948 in the bundle');
minusOne.chapters = minusOne.chapters.filter((c) => c !== removed);
// keep the remaining positions contiguous, as the validator requires
minusOne.chapters.filter((c) => c.subject === removed.subject && c.sequenceNo > removed.sequenceNo).forEach((c) => { c.sequenceNo -= 1; });
const minusOneProblems = validateBundle(minusOne, { today });
if (minusOneProblems.length > 0) {
  console.error('the minus-one variant is invalid:', minusOneProblems);
  process.exit(1);
}
write('published-minus-one.sql', minusOne);

// Written WITHOUT validation: the database readiness rule itself must stop it.
const noChapters = publishForTest(load(), today);
noChapters.chapters.filter((c) => c.subject === 'omsm').forEach((c) => { c.status = 'draft'; });
write('bad-group-without-chapters.sql', noChapters);

// ---- staged publication: Group I first, Group II later --------------------------------------------------------------------
const stagedStep = (name: string, version: string, build: () => Bundle) => {
  const b = build();
  b.meta.bundleVersion = version;
  const problems = validateBundle(b, { today });
  if (problems.length > 0) {
    console.error(`${name} is invalid:`, problems);
    process.exit(1);
  }
  write(name, b);
};
stagedStep('g1-hierarchy.sql', 'stage-1', () => publishGroupForTest(load(), 'group-1', today, false));
stagedStep('g1-enabled.sql', 'stage-2', () => publishGroupForTest(load(), 'group-1', today, true));
stagedStep('g1-g2-enabled.sql', 'stage-3', () => publishForTest(load(), today));

// The reviewed outline, split per group, is what the database hierarchy must equal before availability is enabled.
const golden = readFileSync(resolve('scripts/curriculum/__fixtures__/real-bundle-outline.txt'), 'utf8').replace(/\n$/, '');
const at = golden.indexOf('\nGroup II\n');
if (at < 0) throw new Error('golden outline has no Group II');
writeFileSync(resolve(out, 'golden-g1.txt'), golden.slice(0, at));
writeFileSync(resolve(out, 'golden-g2.txt'), golden.slice(at + 1));
writeFileSync(resolve(out, 'golden-all.txt'), golden);

console.log(`wrote real-bundle test SQL to ${out}`);
