import { describe, expect, it } from 'vitest';
import { computeProgress } from '@/lib/achievements';
import { buildStudyLog, minutesBySubject, plannedMinutesByDate, revisionBucket, subjectStats, weakAreas, weakSubjects } from '@/lib/analytics';
import { BUNDLED_CURRICULUM } from '@/lib/curriculum/bundled';
import { buildSearchIndex } from '@/lib/search';
import { groupCompletion, overallCompletion } from '@/lib/selectors';
import { createSeedData } from '@/data/seed';
import { U } from '@/test/accountFixtures';
import type { Chapter, StudyDataSnapshot, Subject } from '@/types/study';

/**
 * Local mode and account mode run the SAME selectors. This proves it: the sample data is re-expressed in account form (every subject and
 * chapter gets a database-style uuid, the rest unchanged) and every selector must produce the same numbers. If a selector ever depended on
 * the sample ids, or on the bundled subject list, account mode would quietly show different results from local mode.
 */
const TODAY = '2026-11-08';
const local = createSeedData(TODAY);
const localSubjects = BUNDLED_CURRICULUM.subjects as unknown as Subject[];

const subjectMap = new Map(localSubjects.map((s, i) => [s.id, U(5000 + i)]));
const chapterMap = new Map(local.chapters.map((c, i) => [c.id, U(6000 + i)]));
const back = new Map<string, string>([...subjectMap, ...chapterMap].map(([from, to]) => [to, from]));
const sub = (id: string) => subjectMap.get(id) ?? id;
const chap = (id: string) => chapterMap.get(id) ?? id;

const accountSubjects: Subject[] = localSubjects.map((s) => ({ ...s, id: sub(s.id), slug: `slug-${s.id}` }));
const account: StudyDataSnapshot = {
  ...local,
  chapters: local.chapters.map((c): Chapter => ({ ...c, id: chap(c.id), subjectId: sub(c.subjectId) })),
  sessions: local.sessions.map((s) => ({ ...s, subjectId: sub(s.subjectId), chapterId: chap(s.chapterId) })),
  revisions: local.revisions.map((r) => ({ ...r, chapterId: chap(r.chapterId) })),
  focusLog: local.focusLog.map((f) => ({ ...f, subjectId: sub(f.subjectId), chapterId: chap(f.chapterId) })),
  mockExams: local.mockExams.map((m) => ({ ...m, subjectId: sub(m.subjectId) })),
  practiceLog: local.practiceLog.map((p) => ({ ...p, subjectId: sub(p.subjectId), chapterId: chap(p.chapterId) })),
};

/** Puts the sample ids back so results can be compared directly. */
const normalise = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}|00000000-0000-4000-8000-[0-9a-f]{12}/g, (m) => back.get(m) ?? m).replace(/slug-p\d+/g, (m) => m));
const stripSlug = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, val) => (k === 'slug' ? undefined : val)));

describe('selector parity: local sample data vs the same data in account form', () => {
  it('has real data to compare (so the test cannot pass by comparing nothing)', () => {
    expect(local.chapters.length).toBeGreaterThan(20);
    expect(local.focusLog.length).toBeGreaterThan(20);
    expect(local.revisions.length).toBeGreaterThan(5);
    expect(new Set(account.chapters.map((c) => c.id)).size).toBe(local.chapters.length);
    expect(account.chapters.every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true);
  });

  it('overall and per-group completion agree', () => {
    expect(overallCompletion(account.chapters)).toBe(overallCompletion(local.chapters));
    for (const group of ['Group I', 'Group II']) {
      expect(groupCompletion(group, account.chapters, account.revisions, accountSubjects)).toEqual(groupCompletion(group, local.chapters, local.revisions, localSubjects));
    }
  });

  it('per-subject statistics agree', () => {
    for (const s of localSubjects) expect(subjectStats(sub(s.id), account.chapters, account.revisions)).toEqual(subjectStats(s.id, local.chapters, local.revisions));
  });

  it('weak areas and weak subjects agree', () => {
    expect(stripSlug(normalise(weakAreas(account.chapters, accountSubjects, 10)))).toEqual(stripSlug(weakAreas(local.chapters, localSubjects, 10)));
    expect(stripSlug(normalise(weakSubjects(accountSubjects, account.chapters, account.revisions)))).toEqual(stripSlug(weakSubjects(localSubjects, local.chapters, local.revisions)));
  });

  it('study time, streaks, planned minutes and revision buckets agree', () => {
    expect(buildStudyLog(account.focusLog)).toEqual(buildStudyLog(local.focusLog));
    expect(plannedMinutesByDate(account.sessions)).toEqual(plannedMinutesByDate(local.sessions));
    expect(account.revisions.map((r) => revisionBucket(r, TODAY))).toEqual(local.revisions.map((r) => revisionBucket(r, TODAY)));
    const dates = new Set(Object.keys(buildStudyLog(local.focusLog)));
    expect(normalise(minutesBySubject(account.focusLog, dates))).toEqual(minutesBySubject(local.focusLog, dates));
  });

  it('achievements, XP and levels agree', () => {
    const run = (s: StudyDataSnapshot, subjects: Subject[]) => computeProgress({ focusLog: s.focusLog, studyLog: buildStudyLog(s.focusLog), chapters: s.chapters, revisions: s.revisions, practiceLog: s.practiceLog, today: TODAY, subjects });
    expect(run(account, accountSubjects)).toEqual(run(local, localSubjects));
  });

  it('search finds the same chapters (by title) in both', () => {
    const titles = (s: StudyDataSnapshot, subjects: Subject[]) => buildSearchIndex(s, [], subjects).filter((e) => e.kind === 'Chapter').map((e) => `${e.title}|${e.subtitle}`).sort();
    expect(titles(account, accountSubjects)).toEqual(titles(local, localSubjects));
  });

  it('NEGATIVE CONTROL: the comparison does detect a difference (a corrupted account chapter changes the result)', () => {
    const broken = { ...account, chapters: account.chapters.map((c, i) => (i === 0 ? { ...c, status: c.status === 'completed' ? ('learning' as const) : ('completed' as const) } : c)) };
    expect(overallCompletion(broken.chapters)).not.toBe(overallCompletion(local.chapters));
  });
});
