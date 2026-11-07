import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadBundle } from './bundle-io.ts';
import type { Bundle } from './types.ts';
import { validateBundle } from './validate.ts';

const FIXTURE = resolve(__dirname, '__fixtures__/fake-bundle');
const TODAY = '2026-11-08';
const load = (): Bundle => loadBundle(resolve(FIXTURE, 'bundle'), resolve(FIXTURE, 'shared'));
const issuesOf = (b: Bundle) => validateBundle(b, { today: TODAY });
const hasIssue = (b: Bundle, path: string, text = '') =>
  issuesOf(b).some((i) => i.path.includes(path) && i.message.includes(text));

describe('validateBundle: the fake fixture', () => {
  it('is valid', () => {
    expect(issuesOf(load())).toEqual([]);
  });

  it('is labelled fake everywhere, so it can never be mistaken for real data', () => {
    const b = load();
    expect(b.meta.bundleKey.startsWith('fake')).toBe(true);
    expect(b.chapters.every((c) => c.stableKey.startsWith('fake-') && c.title.startsWith('FAKE'))).toBe(true);
    expect(b.attempts.every((a) => a.year >= 2090)).toBe(true);
    expect(b.resources.every((r) => r.url.includes('.invalid'))).toBe(true);
  });
});

describe('validateBundle: identity and structure', () => {
  it('rejects an unknown schemaVersion', () => {
    const b = load();
    b.meta.schemaVersion = 99;
    expect(hasIssue(b, 'meta.schemaVersion', 'unsupported')).toBe(true);
  });

  it.each([
    ['uppercase', 'Fake-Key'],
    ['spaces', 'fake key'],
    ['leading separator', '-fake'],
    ['double separator', 'fake--key'],
    ['too long', 'a'.repeat(121)],
    ['empty', ''],
  ])('rejects a malformed stable key (%s)', (_label, key) => {
    const b = load();
    b.chapters[0].stableKey = key;
    expect(hasIssue(b, 'chapters[0].stableKey')).toBe(true);
  });

  it('rejects duplicate stable keys in every collection', () => {
    for (const [collection, make] of [
      ['groups', (b: Bundle) => b.groups.push({ ...b.groups[0], sortOrder: 3 })],
      ['subjects', (b: Bundle) => b.subjects.push({ ...b.subjects[0], slug: 'other', paperNumber: 9, sortOrder: 9 })],
      ['sections', (b: Bundle) => b.sections.push({ ...b.sections[0], sortOrder: 9 })],
      ['chapters', (b: Bundle) => b.chapters.push({ ...b.chapters[0], sequenceNo: 9 })],
      ['weightages', (b: Bundle) => b.weightages.push({ ...b.weightages[0] })],
      ['resources', (b: Bundle) => b.resources.push({ ...b.resources[0], url: 'https://example.invalid/other' })],
      ['sources', (b: Bundle) => b.sources.push({ ...b.sources[0] })],
      ['attempts', (b: Bundle) => b.attempts.push({ ...b.attempts[0], year: 2099 })],
    ] as Array<[string, (b: Bundle) => void]>) {
      const b = load();
      make(b);
      expect(issuesOf(b).some((i) => i.message.includes('duplicate')), `duplicate in ${collection}`).toBe(true);
    }
  });

  it('rejects references that do not resolve', () => {
    const cases: Array<[string, (b: Bundle) => void, string]> = [
      ['subject group', (b) => { b.subjects[0].group = 'nope'; }, 'subjects[0].group'],
      ['section subject', (b) => { b.sections[0].subject = 'nope'; }, 'sections[0].subject'],
      ['section parent', (b) => { b.sections[1].parent = 'nope'; }, 'sections[1].parent'],
      ['chapter subject', (b) => { b.chapters[0].subject = 'nope'; }, 'chapters[0].subject'],
      ['chapter section', (b) => { b.chapters[0].section = 'nope'; }, 'chapters[0].section'],
      ['superseded chapter', (b) => { b.chapters[0].supersededBy = 'nope'; }, 'chapters[0].supersededBy'],
      ['weightage target', (b) => { b.weightages[0].target = 'nope'; }, 'weightages[0].target'],
      ['resource subject', (b) => { b.resources[0].scope.subject = 'nope'; }, 'resources[0].scope.subject'],
      ['resource attempt', (b) => { b.resources[1].scope.attempt = 'nope'; }, 'resources[1].scope.attempt'],
      ['availability attempt', (b) => { b.availability[0].attempt = 'nope'; }, 'availability[0].attempt'],
      ['source reference', (b) => { b.chapters[0].sourceRef = 'nope'; }, 'chapters[0].sourceRef'],
    ];
    for (const [label, mutate, path] of cases) {
      const b = load();
      mutate(b);
      expect(hasIssue(b, path), label).toBe(true);
    }
  });

  it('keeps hierarchy in one subject', () => {
    const b = load();
    b.sections[1].subject = 'fake-subject-2'; // child in subject 2, parent still in subject 1
    expect(hasIssue(b, 'sections[1].parent', 'same subject')).toBe(true);
    const c = load();
    c.chapters[0].subject = 'fake-subject-2'; // chapter in subject 2, section in subject 1
    expect(hasIssue(c, 'chapters[0].section', 'same subject')).toBe(true);
  });

  it('rejects a section cycle and a self-parent', () => {
    const b = load();
    b.sections[0].parent = 'fake-section-a1'; // a -> a1 -> a
    expect(issuesOf(b).some((i) => i.message.includes('cycle'))).toBe(true);
    const c = load();
    c.sections[0].parent = 'fake-section-a';
    expect(issuesOf(c).some((i) => i.message.includes('cycle'))).toBe(true);
  });

  it('rejects a chapter that supersedes itself', () => {
    const b = load();
    b.chapters[0].supersededBy = b.chapters[0].stableKey;
    expect(hasIssue(b, 'chapters[0].supersededBy', 'itself')).toBe(true);
  });

  it('requires official order to be exactly 1..n', () => {
    const gap = load();
    gap.chapters[1].sequenceNo = 5; // 1, 5, 3 in subject 1
    expect(issuesOf(gap).some((i) => i.path.includes('chapters in subject fake-subject-1'))).toBe(true);
    const repeat = load();
    repeat.chapters[1].sequenceNo = 1;
    expect(issuesOf(repeat).some((i) => i.path.includes('chapters in subject fake-subject-1'))).toBe(true);
    const groupGap = load();
    groupGap.groups[1].sortOrder = 4;
    expect(issuesOf(groupGap).some((i) => i.path === 'groups')).toBe(true);
    const sectionGap = load();
    sectionGap.sections[1].sortOrder = 2;
    expect(issuesOf(sectionGap).some((i) => i.path.includes('sections under'))).toBe(true);
  });

  it('rejects duplicate paper numbers and slugs', () => {
    const b = load();
    b.subjects[1].paperNumber = b.subjects[0].paperNumber;
    expect(hasIssue(b, 'subjects[1].paperNumber', 'duplicate')).toBe(true);
    const c = load();
    c.subjects[1].slug = c.subjects[0].slug;
    expect(hasIssue(c, 'subjects[1].slug', 'duplicate')).toBe(true);
    const d = load();
    d.subjects[0].slug = 'Not A Slug';
    expect(hasIssue(d, 'subjects[0].slug')).toBe(true);
  });
});

describe('validateBundle: nothing unverified is published', () => {
  it('requires a source and a verification date on every published record', () => {
    const kinds: Array<[string, (b: Bundle) => { sourceRef: string | null; verifiedAt: string | null; verifiedBy: string | null }]> = [
      ['course', (b) => b.meta.course],
      ['syllabus', (b) => b.meta.syllabus],
      ['csv', (b) => b.meta.courseSyllabus],
      ['group', (b) => b.groups[0]],
      ['subject', (b) => b.subjects[0]],
      ['section', (b) => b.sections[0]],
      ['chapter', (b) => b.chapters[0]],
      ['weightage', (b) => b.weightages[0]],
      ['resource', (b) => b.resources[0]],
      ['attempt', (b) => b.attempts[0]],
    ];
    for (const [label, pick] of kinds) {
      const noSource = load();
      pick(noSource).sourceRef = null;
      expect(issuesOf(noSource).some((i) => i.message.includes('needs a source')), `${label}: source`).toBe(true);
      const noDate = load();
      pick(noDate).verifiedAt = null;
      expect(issuesOf(noDate).some((i) => i.message.includes('needs a verification date')), `${label}: date`).toBe(true);
      const noVerifier = load();
      (pick(noVerifier) as { verifiedBy: string | null }).verifiedBy = null;
      expect(issuesOf(noVerifier).some((i) => i.message.includes('needs a verifier')), `${label}: verifier`).toBe(true);
    }
  });

  it('requires verifiedBy to be a maintainer handle, never an email or free text', () => {
    for (const handle of ['someone@example.invalid', 'two words', '-leading-hyphen', 'a'.repeat(40), 'dots.not.allowed', '']) {
      const b = load();
      b.chapters[0].verifiedBy = handle;
      expect(hasIssue(b, 'chapters[0].verifiedBy', 'maintainer handle'), JSON.stringify(handle)).toBe(true);
    }
    for (const handle of ['Jithendhar18', 'fake-maintainer', 'a', 'A1-b2']) {
      const b = load();
      b.chapters[0].verifiedBy = handle;
      expect(issuesOf(b), handle).toEqual([]);
    }
  });

  it('requires a verifier to enable an attempt', () => {
    const b = load();
    b.availability[0].verifiedBy = null;
    expect(hasIssue(b, 'availability[0]', 'needs a source reference, a verification date and a verifier')).toBe(true);
  });

  it('accepts a draft with no verification at all', () => {
    const b = load();
    b.chapters[0].status = 'draft';
    b.chapters[0].sourceRef = null;
    b.chapters[0].verifiedAt = null;
    b.chapters[0].verifiedBy = null;
    expect(issuesOf(b)).toEqual([]);
  });

  it('rejects impossible or inconsistent dates', () => {
    const future = load();
    future.chapters[0].verifiedAt = '2027-01-01';
    expect(hasIssue(future, 'chapters[0].verifiedAt', 'future')).toBe(true);
    const fake = load();
    fake.chapters[0].verifiedAt = '2000-02-30';
    expect(hasIssue(fake, 'chapters[0].verifiedAt', 'real')).toBe(true);
    const before = load();
    before.chapters[0].verifiedAt = '1999-12-31'; // before its source was retrieved (2000-01-02)
    expect(hasIssue(before, 'chapters[0].verifiedAt', 'before its source')).toBe(true);
    const badSource = load();
    badSource.sources[0].retrievedOn = '2999-01-01';
    expect(hasIssue(badSource, 'sources[0].retrievedOn', 'future')).toBe(true);
  });

  it('requires https links', () => {
    for (const url of ['http://example.invalid/x', 'javascript:alert(1)', 'ftp://example.invalid/x', 'not a url', '']) {
      const b = load();
      b.resources[0].url = url;
      expect(hasIssue(b, 'resources[0].url'), url).toBe(true);
    }
    const c = load();
    c.sources[0].url = 'http://example.invalid';
    expect(hasIssue(c, 'sources[0].url')).toBe(true);
  });

  it('rejects duplicate resources for the same scope but allows the same link for another scope', () => {
    const dup = load();
    dup.resources.push({ ...dup.resources[0], stableKey: 'fake-resource-dup' });
    expect(issuesOf(dup).some((i) => i.message.includes('duplicate resource'))).toBe(true);
    const ok = load();
    ok.resources.push({ ...ok.resources[0], stableKey: 'fake-resource-other', scope: { subject: 'fake-subject-2', chapter: null, attempt: null } });
    expect(issuesOf(ok)).toEqual([]);
  });
});

describe('validateBundle: readiness mirrors the database rule', () => {
  it('rejects a published CSV whose course or syllabus is not published', () => {
    const a = load();
    a.meta.course.status = 'draft';
    expect(hasIssue(a, 'meta.course.status', 'course must be published')).toBe(true);
    const b = load();
    b.meta.syllabus.status = 'draft';
    expect(hasIssue(b, 'meta.syllabus.status')).toBe(true);
  });

  it('rejects a published group with no published subject', () => {
    const b = load();
    b.subjects.filter((s) => s.group === 'fake-group-2').forEach((s) => { s.status = 'draft'; });
    b.chapters.filter((c) => c.subject === 'fake-subject-3').forEach((c) => { c.status = 'draft'; });
    expect(issuesOf(b).some((i) => i.message.includes('has no published subject'))).toBe(true);
  });

  it('rejects a published subject with no published chapter', () => {
    const b = load();
    b.chapters.filter((c) => c.subject === 'fake-subject-2').forEach((c) => { c.status = 'draft'; });
    expect(issuesOf(b).some((i) => i.message.includes('has no published chapter'))).toBe(true);
  });

  it('refuses a published bundle with no groups (it would retire everything)', () => {
    const b = load();
    b.groups = [];
    b.subjects = [];
    b.sections = [];
    b.chapters = [];
    b.weightages = [];
    b.resources = [];
    expect(issuesOf(b).some((i) => i.message.includes('retire everything'))).toBe(true);
  });

  it('does not require readiness while the CSV is only a draft', () => {
    const b = load();
    b.meta.courseSyllabus.status = 'draft';
    b.availability = [];
    b.chapters.forEach((c) => { c.status = 'draft'; });
    expect(issuesOf(b)).toEqual([]);
  });
});

describe('validateBundle: attempts and availability', () => {
  it('never accepts an invented date', () => {
    const noStart = load();
    noStart.attempts[0].dateStatus = 'official';
    expect(hasIssue(noStart, 'attempts[0].dateStatus', 'never invented')).toBe(true);
    const provisional = load();
    provisional.attempts[0].dateStatus = 'provisional';
    expect(hasIssue(provisional, 'attempts[0].dateStatus')).toBe(true);
    const endOnly = load();
    endOnly.attempts[0].examEndDate = '2090-12-10';
    expect(hasIssue(endOnly, 'attempts[0].examEndDate', 'start date')).toBe(true);
    const reversed = load();
    reversed.attempts[0].examStartDate = '2090-12-10';
    reversed.attempts[0].examEndDate = '2090-12-01';
    reversed.attempts[0].dateStatus = 'official';
    expect(hasIssue(reversed, 'attempts[0].examEndDate', 'before the start')).toBe(true);
  });

  it('accepts an attempt with no date (unannounced)', () => {
    expect(issuesOf(load())).toEqual([]);
    expect(load().attempts.every((a) => a.examStartDate === null)).toBe(true);
  });

  it('allows the same attempt for different syllabus versions but not a repeated (year, session)', () => {
    const b = load();
    b.attempts.push({ ...b.attempts[0], stableKey: 'fake-attempt-dup' });
    expect(issuesOf(b).some((i) => i.message.includes('duplicate attempt (year, session)'))).toBe(true);
  });

  it('cannot enable an attempt that is not published, or without verification', () => {
    const draftAttempt = load();
    draftAttempt.availability.push({ attempt: 'fake-attempt-c', status: 'enabled', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer' });
    expect(hasIssue(draftAttempt, 'availability[2].attempt', 'not published')).toBe(true);
    const unverified = load();
    unverified.availability[0].verifiedAt = null;
    expect(hasIssue(unverified, 'availability[0]', 'needs a source reference, a verification date and a verifier')).toBe(true);
    const draftCsv = load();
    draftCsv.meta.courseSyllabus.status = 'draft';
    expect(issuesOf(draftCsv).some((i) => i.message.includes('not published'))).toBe(true);
  });
});

describe('validateBundle: weightages are never fabricated', () => {
  it('requires a source even for a draft weightage', () => {
    const b = load();
    b.weightages[0].status = 'draft';
    b.weightages[0].sourceRef = null;
    b.weightages[0].verifiedAt = null;
    expect(hasIssue(b, 'weightages[0].sourceRef', 'source that published')).toBe(true);
  });

  it('checks level, target and range', () => {
    const wrongLevel = load();
    wrongLevel.weightages[0].level = 'chapter'; // target is a section key
    expect(hasIssue(wrongLevel, 'weightages[0].target')).toBe(true);
    const range = load();
    range.weightages[0].minPercent = 40;
    range.weightages[0].maxPercent = 30;
    expect(hasIssue(range, 'weightages[0]', 'percentages')).toBe(true);
    const over = load();
    over.weightages[0].maxPercent = 101;
    expect(hasIssue(over, 'weightages[0]', 'percentages')).toBe(true);
  });

  it('accepts a chapter-level weightage only when it is genuinely different data', () => {
    const own = load();
    own.weightages.push({
      stableKey: 'fake-weightage-ch1', level: 'chapter', target: 'fake-ch-1', minPercent: 5, maxPercent: 8,
      publishedLabel: 'FAKE chapter value as published', status: 'published', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer',
    });
    expect(issuesOf(own)).toEqual([]);
  });

  it('rejects chapter weightages that copy their section percentage (looks distributed from the section)', () => {
    const b = load();
    // fake-section-a1 holds ch-1 and ch-2. Give the section a value, then spread the same value onto a chapter.
    b.weightages.push({
      stableKey: 'fake-weightage-a1', level: 'section', target: 'fake-section-a1', minPercent: 10, maxPercent: 20,
      publishedLabel: 'FAKE', status: 'published', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer',
    });
    b.weightages.push({
      stableKey: 'fake-weightage-ch-spread', level: 'chapter', target: 'fake-ch-1', minPercent: 10, maxPercent: 20,
      publishedLabel: 'FAKE', status: 'published', sourceRef: 'fake-source-1', verifiedAt: '2000-01-05', verifiedBy: 'fake-maintainer',
    });
    expect(issuesOf(b).some((i) => i.message.includes('do not spread section percentages'))).toBe(true);
  });
});

describe('validateBundle: text safety', () => {
  it('rejects empty, over-long and control-character text', () => {
    const empty = load();
    empty.chapters[0].title = '   ';
    expect(hasIssue(empty, 'chapters[0].title', 'non-empty')).toBe(true);
    const long = load();
    long.chapters[0].title = 'x'.repeat(501);
    expect(hasIssue(long, 'chapters[0].title', 'longer')).toBe(true);
    const nul = load();
    nul.chapters[0].title = 'bad\u0000title';
    expect(hasIssue(nul, 'chapters[0].title', 'control character')).toBe(true);
    const bell = load();
    bell.resources[0].title = 'bad\u0007title';
    expect(hasIssue(bell, 'resources[0].title', 'control character')).toBe(true);
  });

  it('accepts ordinary punctuation including quotes and unicode', () => {
    const b = load();
    b.chapters[0].title = "FAKE Chapter: O'Brien & Co. – “quotes” (₹)";
    expect(issuesOf(b)).toEqual([]);
  });

  it('rejects invalid optional numbers', () => {
    const b = load();
    b.chapters[0].suggestedStudyHours = -2;
    expect(hasIssue(b, 'chapters[0].suggestedStudyHours')).toBe(true);
    const ok = load();
    ok.chapters[0].suggestedStudyHours = 6.5;
    expect(issuesOf(ok)).toEqual([]);
  });
});
