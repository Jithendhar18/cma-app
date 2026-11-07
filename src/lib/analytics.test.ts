import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedData } from '@/data/seed';
import { SUBJECTS } from '@/data/subjects';
import {
  averageAccuracy, buildStudyLog, chapterAccuracy, consistencyScore, effectiveSessionStatus, lastNDaysMinutes,
  minutesBySubject, mockPercent, plannedMinutesByDate, rangeDates, revisionBucket, studyStreak, subjectMockSummary,
  subjectStats, todayMinutes, totalMinutes, weakAreas, weakSubjects, weeklySeries,
} from '@/lib/analytics';
import { computeProgress, longestStreak } from '@/lib/achievements';
import { overallCompletion } from '@/lib/selectors';
import type { FocusRecord, RevisionTask, StudyDataSnapshot } from '@/types/study';

const TODAY = '2026-11-10';
let seed: StudyDataSnapshot;
beforeEach(() => {
  seed = createSeedData(TODAY);
});

const rec = (id: string, date: string, minutes: number, subjectId = 'p5'): FocusRecord => ({ id, date, subjectId, chapterId: `${subjectId}-1`, minutes, mode: 'pomodoro', notes: '', sessionId: null });

describe('daily totals', () => {
  it('buildStudyLog sums records per date and the dashboard figures derive from it', () => {
    const log = buildStudyLog([rec('a', TODAY, 30), rec('b', TODAY, 45), rec('c', '2026-11-09', 60)]);
    expect(log).toEqual({ [TODAY]: 75, '2026-11-09': 60 });
    expect(todayMinutes(log, TODAY)).toBe(75);
    expect(totalMinutes(log)).toBe(135);
  });

  it('seeded today total matches the sum of today\'s focus records', () => {
    const log = buildStudyLog(seed.focusLog);
    expect(log[TODAY]).toBe(seed.focusLog.filter((r) => r.date === TODAY).reduce((s, r) => s + r.minutes, 0));
  });

  it('the study log and per-chapter hours always agree on the grand total', () => {
    const fromLog = totalMinutes(buildStudyLog(seed.focusLog));
    const fromChapters = seed.chapters.reduce((s, c) => s + c.actualHours * 60, 0);
    expect(fromChapters).toBeCloseTo(fromLog, 3);
  });

  it('weeklySeries is Monday-first and marks future days', () => {
    const series = weeklySeries(buildStudyLog(seed.focusLog), TODAY);
    expect(series).toHaveLength(7);
    expect(series[0].date).toBe('2026-11-09');
    expect(series[1]).toMatchObject({ date: TODAY, isFuture: false });
    expect(series[2].isFuture).toBe(true);
  });

  it('lastNDaysMinutes ends today and zero-fills gaps', () => {
    const out = lastNDaysMinutes({ [TODAY]: 50 }, TODAY, 3);
    expect(out).toEqual([0, 0, 50]);
  });
});

describe('streaks', () => {
  it('counts consecutive days ending today', () => {
    expect(studyStreak({ [TODAY]: 10, '2026-11-09': 10, '2026-11-08': 10, '2026-11-06': 10 }, TODAY)).toBe(3);
  });

  it('still counts a streak that ended yesterday', () => {
    expect(studyStreak({ '2026-11-09': 10, '2026-11-08': 10 }, TODAY)).toBe(2);
  });

  it('is zero after a missed day', () => {
    expect(studyStreak({ '2026-11-07': 10 }, TODAY)).toBe(0);
  });

  it('computes the longest streak across a gap', () => {
    expect(longestStreak({ '2026-11-01': 5, '2026-11-02': 5, '2026-11-03': 5, '2026-11-05': 5, '2026-11-06': 5 })).toBe(3);
  });
});

describe('ranges and consistency', () => {
  it('rangeDates returns inclusive windows ending today', () => {
    const week = rangeDates('7d', {}, TODAY);
    expect(week).toHaveLength(7);
    expect(week[6]).toBe(TODAY);
    expect(week[0]).toBe('2026-11-04');
  });

  it('"all time" starts at the first logged day', () => {
    const dates = rangeDates('all', { '2026-11-05': 60 }, TODAY);
    expect(dates[0]).toBe('2026-11-05');
    expect(dates[dates.length - 1]).toBe(TODAY);
  });

  it('consistencyScore caps each day at the target', () => {
    expect(consistencyScore({ a: 480, b: 960 }, ['a', 'b', 'c', 'd'], 480)).toBe(50);
    expect(consistencyScore({}, [], 480)).toBe(0);
  });

  it('minutesBySubject only counts days in range', () => {
    const out = minutesBySubject([rec('a', TODAY, 30, 'p5'), rec('b', '2026-10-01', 90, 'p6')], new Set([TODAY]));
    expect(out).toEqual({ p5: 30 });
  });

  it('plannedMinutesByDate sums planned sessions', () => {
    expect(plannedMinutesByDate(seed.sessions)[TODAY]).toBe(90 + 60 + 90 + 60);
  });
});

describe('chapters and subjects', () => {
  it('computes chapter accuracy and handles no practice', () => {
    const c = { ...seed.chapters[0], questionsPracticed: 20, correctAnswers: 15 };
    expect(chapterAccuracy(c)).toBe(75);
    expect(chapterAccuracy({ ...c, questionsPracticed: 0 })).toBeNull();
    expect(averageAccuracy([])).toBeNull();
  });

  it('subject stats come from chapter status, hours and revisions', () => {
    const stats = subjectStats('p6', seed.chapters, seed.revisions);
    const own = seed.chapters.filter((c) => c.subjectId === 'p6');
    expect(stats.total).toBe(own.length);
    expect(stats.done).toBe(own.filter((c) => ['completed', 'revision_due', 'exam_ready'].includes(c.status)).length);
    expect(stats.actualHours).toBeCloseTo(own.reduce((s, c) => s + c.actualHours, 0), 9);
  });

  it('syllabus completion counts done chapters only', () => {
    const half = seed.chapters.map((c, i) => ({ ...c, status: i % 2 === 0 ? ('completed' as const) : ('learning' as const) }));
    expect(overallCompletion(half)).toBe(50);
    expect(overallCompletion([])).toBe(0);
  });

  it('cancelled revisions do not count towards revision totals', () => {
    const revisions: RevisionTask[] = seed.revisions.map((r) => (r.chapterId === 'p6-3' ? { ...r, cancelledOn: TODAY } : r));
    const before = subjectStats('p6', seed.chapters, seed.revisions);
    const after = subjectStats('p6', seed.chapters, revisions);
    expect(after.revisionsTotal).toBe(before.revisionsTotal - 1);
  });

  it('flags weak chapters and subjects from accuracy and confidence', () => {
    const areas = weakAreas(seed.chapters, SUBJECTS, 50);
    expect(areas.length).toBeGreaterThan(0);
    areas.forEach((a) => expect(a.chapter.confidence <= 2 || (a.accuracy ?? 100) < 60).toBe(true));
    expect(areas.every((a) => a.chapter.status !== 'not_started')).toBe(true);
    const subjects = weakSubjects(SUBJECTS, seed.chapters, seed.revisions);
    subjects.forEach((s) => expect(s.accuracy).toBeLessThan(60));
  });
});

describe('revision buckets and session status', () => {
  const base: RevisionTask = { id: 'x', chapterId: 'p5-1', revisionNumber: 1, dueDate: TODAY, completedOn: null, priority: 'low' };

  it('classifies by due date, completion and cancellation', () => {
    expect(revisionBucket({ ...base, dueDate: '2026-11-09' }, TODAY)).toBe('overdue');
    expect(revisionBucket(base, TODAY)).toBe('today');
    expect(revisionBucket({ ...base, dueDate: '2026-11-12' }, TODAY)).toBe('upcoming');
    expect(revisionBucket({ ...base, completedOn: TODAY }, TODAY)).toBe('completed');
    expect(revisionBucket({ ...base, cancelledOn: TODAY }, TODAY)).toBe('cancelled');
    expect(revisionBucket({ ...base, completedOn: TODAY, cancelledOn: TODAY }, TODAY)).toBe('cancelled');
  });

  it('shows an unfinished session from a past day as missed, but not today\'s', () => {
    const s = seed.sessions.find((x) => x.id === 's-3')!;
    expect(effectiveSessionStatus(s, TODAY)).toBe('upcoming');
    expect(effectiveSessionStatus({ ...s, date: '2026-11-09' }, TODAY)).toBe('missed');
    expect(effectiveSessionStatus({ ...s, date: '2026-11-09', status: 'completed' }, TODAY)).toBe('completed');
  });
});

describe('mock exams', () => {
  it('computes percentages and the change since the previous attempt', () => {
    const summary = subjectMockSummary(seed.mockExams, 'p6');
    expect(summary.count).toBe(2);
    expect(summary.latest).toBeCloseTo(58, 6);
    expect(summary.delta).toBeCloseTo(10, 6);
    expect(mockPercent({ id: 'z', date: TODAY, subjectId: 'p5', name: 'z', score: 1, maxScore: 0 })).toBe(0);
    expect(subjectMockSummary(seed.mockExams, 'p9')).toEqual({ count: 0, latest: null, delta: null });
  });
});

describe('achievements', () => {
  it('derives XP, level and badges from the same data', () => {
    const studyLog = buildStudyLog(seed.focusLog);
    const progress = computeProgress({ focusLog: seed.focusLog, studyLog, chapters: seed.chapters, revisions: seed.revisions, practiceLog: seed.practiceLog, today: TODAY });
    expect(progress.xp).toBeGreaterThan(0);
    expect(progress.level).toBeGreaterThanOrEqual(1);
    expect(progress.badges.find((b) => b.id === 'first-focus')?.current).toBeGreaterThanOrEqual(1);
    const questions = seed.practiceLog.reduce((s, p) => s + p.questions, 0);
    expect(progress.badges.find((b) => b.id === 'q-100')?.current).toBe(questions);
  });

  it('starts at level 1 with nothing logged', () => {
    const empty = computeProgress({ focusLog: [], studyLog: {}, chapters: [], revisions: [], practiceLog: [], today: TODAY });
    expect(empty).toMatchObject({ xp: 0, level: 1, streak: 0 });
  });
});
