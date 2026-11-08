import { createSeedData } from '@/data/seed';
import type { StudyDataSnapshot } from '@/types/study';

export const TODAY = '2026-11-08';

/**
 * A local-mode snapshot as a real student's device holds it: the untouched sample data (flagged `demo`) PLUS some records the student made
 * themselves (not flagged). Local ids are the sample curriculum's (`p5-1`, `p5`), which are NOT account curriculum ids.
 */
export function localWithOwnData(): StudyDataSnapshot {
  const base = createSeedData(TODAY);
  const [c1, c2] = base.chapters.filter((c) => c.subjectId === base.chapters[0].subjectId);
  const subjectId = c1.subjectId;
  const own = (id: string) => ({ ...base.chapters.find((c) => c.id === id)!, demo: false });
  return {
    ...base,
    chapters: base.chapters.map((c) => (c.id === c1.id ? { ...own(c1.id), status: 'completed' as const, confidence: 4 as const, notes: 'my notes', completedOn: '2026-11-02' } : c.id === c2.id ? { ...own(c2.id), status: 'practising' as const, confidence: 2 as const } : c)),
    sessions: [...base.sessions, { id: 's-own-1', date: '2026-11-09', subjectId, chapterId: c1.id, startTime: '09:30', durationMinutes: 60, status: 'completed', priority: 'high', notes: 'mine' }],
    focusLog: [
      ...base.focusLog,
      { id: 'plan-s-own-1', date: '2026-11-09', subjectId, chapterId: c1.id, minutes: 60, mode: 'planner', notes: 'mine', sessionId: 's-own-1' },
      { id: 'focus-own-1', date: '2026-11-08', subjectId, chapterId: c1.id, minutes: 25, mode: 'pomodoro', notes: '', sessionId: null },
      { id: 'focus-own-2', date: '2026-11-08', subjectId, chapterId: c2.id, minutes: 40, mode: 'stopwatch', notes: '', sessionId: null },
    ],
    practiceLog: [...base.practiceLog, { id: 'pr-own-1', date: '2026-11-07', chapterId: c2.id, subjectId, questions: 20, correct: 15 }],
    revisions: [...base.revisions, { id: 'rev-own-1', chapterId: c1.id, revisionNumber: 1, dueDate: '2026-11-10', completedOn: null, priority: 'medium' }],
    mockExams: [...base.mockExams, { id: 'm-own-1', date: '2026-11-05', subjectId, name: 'My mock', score: 61, maxScore: 100 }],
  };
}

export const localIds = (s: StudyDataSnapshot) => {
  const subjectId = s.chapters[0].subjectId;
  const [c1, c2] = s.chapters.filter((c) => c.subjectId === subjectId);
  return { subjectId, c1: c1.id, c2: c2.id };
};

/** The persisted form of the local store, exactly as `cma-study-os` holds it. */
export const persistedLocal = (s: StudyDataSnapshot) => JSON.stringify({ state: s, version: 3 });
