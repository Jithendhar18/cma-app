/**
 * Builds the SQL files used by scripts/db/test-importer.sh from the FAKE fixture bundle.
 *   v1.sql   the fixture as-is
 *   v2.sql   an update: renamed title, swapped order, one chapter removed, one added, link and weightage changed,
 *            one attempt no longer offered
 *   bad-*.sql  deliberately incomplete bundles, generated WITHOUT validation, to prove the database refuses them
 * All files are written without BEGIN/COMMIT so the test controls the transaction and rolls it back.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashBundle, loadBundle } from '../curriculum/bundle-io.ts';
import { generateSql } from '../curriculum/generate-sql.ts';
import type { Bundle } from '../curriculum/types.ts';
import { validateBundle } from '../curriculum/validate.ts';

const out = resolve(process.argv[2] ?? 'tmp-import-test');
const fixture = resolve('scripts/curriculum/__fixtures__/fake-bundle');
const load = (): Bundle => loadBundle(resolve(fixture, 'bundle'), resolve(fixture, 'shared'));
const write = (name: string, bundle: Bundle, allowRetireAll = false) => {
  const sql = generateSql(bundle, { contentSha256: hashBundle(bundle), transaction: false, allowRetireAll });
  writeFileSync(resolve(out, name), sql);
};

mkdirSync(out, { recursive: true });

const v1 = load();
write('v1.sql', v1);

const v2 = load();
v2.meta.bundleVersion = '2';
v2.chapters[0].title = 'FAKE Chapter 1 (renamed)';
v2.chapters[0].sequenceNo = 2; // swap the official order of ch-1 and ch-2
v2.chapters[1].sequenceNo = 1;
v2.chapters = v2.chapters.filter((c) => c.stableKey !== 'fake-ch-3'); // removed from the syllabus
v2.chapters.push({
  stableKey: 'fake-ch-6', subject: 'fake-subject-3', section: null, officialLabel: null, title: 'FAKE Chapter 6 (new)',
  sequenceNo: 2, suggestedStudyHours: null, supersededBy: null, status: 'published', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer',
});
v2.resources[0].url = 'https://example.invalid/fake-mcq-moved';
v2.weightages[0].minPercent = 25;
v2.availability = v2.availability.filter((a) => a.attempt === 'fake-attempt-a'); // attempt B no longer offered
const problems = validateBundle(v2, { today: '2026-11-08' });
if (problems.length > 0) {
  console.error('v2 variant is invalid:', problems);
  process.exit(1);
}
write('v2.sql', v2);

// v3: a DRAFT, unverified entry for a chapter that is already published. It must neither unpublish the
// chapter nor erase its recorded verification.
const v3 = load();
v3.meta.bundleVersion = '3';
v3.chapters[1].status = 'draft';
v3.chapters[1].sourceRef = null;
v3.chapters[1].verifiedAt = null;
v3.chapters[1].verifiedBy = null;
v3.chapters[1].title = 'FAKE Chapter 2 (edited while draft)';
const v3problems = validateBundle(v3, { today: '2026-11-08' });
if (v3problems.length > 0) {
  console.error('v3 variant is invalid:', v3problems);
  process.exit(1);
}
write('v3-draft-over-published.sql', v3);

// v4: verification is explicitly repeated by a different maintainer on a later date.
const v4 = load();
v4.meta.bundleVersion = '4';
v4.chapters[0].verifiedBy = 'fake-reviewer';
v4.chapters[0].verifiedAt = '2000-02-01';
const v4problems = validateBundle(v4, { today: '2026-11-08' });
if (v4problems.length > 0) {
  console.error('v4 variant is invalid:', v4problems);
  process.exit(1);
}
write('v4-reverified.sql', v4);

// Incomplete bundles, written without validation. The database readiness rule must abort the import.
const noChapters = load();
noChapters.chapters.filter((c) => c.subject === 'fake-subject-2').forEach((c) => { c.status = 'draft'; });
write('bad-no-chapter.sql', noChapters);

const unverifiedEnable = load();
unverifiedEnable.availability.push({ attempt: 'fake-attempt-c', status: 'enabled', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer' });
write('bad-enable-draft-attempt.sql', unverifiedEnable);

// Retire-all: every chapter is re-keyed, so the import would retire all 5 active chapters. Generated twice.
const rekeyed = load();
rekeyed.chapters.forEach((c) => { c.stableKey = c.stableKey.replace('fake-ch-', 'fake-new-ch-'); });
const rekeyProblems = validateBundle(rekeyed, { today: '2026-11-08' });
if (rekeyProblems.length > 0) {
  console.error('re-keyed variant is invalid:', rekeyProblems);
  process.exit(1);
}
write('retire-all-denied.sql', rekeyed);
write('retire-all-allowed.sql', rekeyed, true);

// Fails LATE (at the final promote step), after earlier statements already changed rows. Used to prove the
// whole import is atomic: the rename below must not survive the failure.
const lateFailure = load();
lateFailure.chapters[0].title = 'FAKE renamed by an import that then fails';
lateFailure.availability.push({ attempt: 'fake-attempt-c', status: 'enabled', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer' });
write('bad-late-failure.sql', lateFailure);

console.log(`wrote import test SQL to ${out}`);
