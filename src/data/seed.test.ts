import { describe, expect, it } from 'vitest';
import { createSeedData, HISTORY_DAYS } from '@/data/seed';
import { SUBJECTS } from '@/data/subjects';
import { addDaysISO } from '@/lib/dates';
import { effectiveSessionStatus, buildStudyLog } from '@/lib/analytics';
import { validateConsistency } from '@/lib/seedValidation';
import { parseSnapshot } from '@/lib/snapshot';

const TODAY = '2026-11-10';

describe('createSeedData', () => {
  const seed = createSeedData(TODAY);

  it('produces a snapshot that passes validation', () => {
    expect(parseSnapshot(seed).ok).toBe(true);
  });

  it('is internally consistent: chapter totals match the records they are derived from', () => {
    expect(validateConsistency(seed)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(createSeedData(TODAY)).toEqual(seed);
  });

  it('has no duplicate ids and covers all eight papers', () => {
    expect(new Set(seed.focusLog.map((r) => r.id)).size).toBe(seed.focusLog.length);
    expect(new Set(seed.chapters.map((c) => c.subjectId)).size).toBe(SUBJECTS.length);
  });

  it('anchors its dates to the given day and records the anchor', () => {
    expect(seed.meta.seedAnchor).toBe(TODAY);
    const log = buildStudyLog(seed.focusLog);
    expect(log[TODAY]).toBe(275);
    expect(Object.keys(log).sort()[0] >= addDaysISO(TODAY, -(HISTORY_DAYS - 1))).toBe(true);
  });

  it('never shows a stale session as missed on the day it is created', () => {
    const today = seed.sessions.filter((s) => s.date === TODAY);
    expect(today.length).toBeGreaterThan(0);
    expect(today.some((s) => effectiveSessionStatus(s, TODAY) === 'missed')).toBe(false);
  });

  it('shifts every date together when generated for another day', () => {
    const later = createSeedData(addDaysISO(TODAY, 30));
    expect(later.sessions.map((s) => s.id)).toEqual(seed.sessions.map((s) => s.id));
    later.sessions.forEach((s, i) => expect(s.date).toBe(addDaysISO(seed.sessions[i].date, 30)));
    expect(later.chapters.map((c) => c.actualHours)).toEqual(seed.chapters.map((c) => c.actualHours));
  });

  it('flags every generated record as demo so it can be refreshed', () => {
    expect(seed.sessions.every((s) => s.demo)).toBe(true);
    expect(seed.focusLog.every((r) => r.demo)).toBe(true);
    expect(seed.chapters.every((c) => c.demo)).toBe(true);
  });

  it('gives every completed chapter a gap-free revision history', () => {
    const numbers = seed.revisions.filter((r) => r.chapterId === 'p11-1').map((r) => r.revisionNumber);
    expect(numbers).toEqual([3, 1, 2]);
    expect(validateConsistency(seed).filter((p) => p.includes('gap'))).toEqual([]);
  });
});

describe('validateConsistency', () => {
  it('detects hours that do not match the focus history', () => {
    const bad = createSeedData(TODAY);
    bad.chapters[0] = { ...bad.chapters[0], actualHours: bad.chapters[0].actualHours + 3 };
    expect(validateConsistency(bad).some((p) => p.includes('focus history'))).toBe(true);
  });

  it('detects question totals that do not match the practice log', () => {
    const bad = createSeedData(TODAY);
    bad.chapters[0] = { ...bad.chapters[0], questionsPracticed: bad.chapters[0].questionsPracticed + 1 };
    expect(validateConsistency(bad).some((p) => p.includes('questions'))).toBe(true);
  });

  it('detects orphaned references, duplicate ids and revision gaps', () => {
    const bad = createSeedData(TODAY);
    bad.sessions.push({ ...bad.sessions[0], chapterId: 'nope' });
    bad.revisions.push({ ...bad.revisions[0] });
    bad.revisions = bad.revisions.filter((r) => !(r.chapterId === 'p11-1' && r.revisionNumber === 1));
    const problems = validateConsistency(bad);
    expect(problems.some((p) => p.includes('missing chapter nope'))).toBe(true);
    expect(problems.some((p) => p.includes('Duplicate'))).toBe(true);
    expect(problems.some((p) => p.includes('gap'))).toBe(true);
  });

  it('flags active revisions on a chapter that is not complete', () => {
    const bad = createSeedData(TODAY);
    bad.chapters = bad.chapters.map((c) => (c.id === 'p5-3' ? { ...c, status: 'learning' as const } : c));
    expect(validateConsistency(bad).some((p) => p.includes('not complete but has active revisions'))).toBe(true);
  });

  it('ignores cancelled revisions', () => {
    const data = createSeedData(TODAY);
    data.chapters = data.chapters.map((c) => (c.id === 'p5-3' ? { ...c, status: 'learning' as const } : c));
    data.revisions = data.revisions.map((r) => (r.chapterId === 'p5-3' ? { ...r, cancelledOn: TODAY } : r));
    expect(validateConsistency(data)).toEqual([]);
  });
});
