import { vi } from 'vitest';
import { createSeedData } from '@/data/seed';
import { toISODate } from '@/lib/dates';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';
import type { StudyDataSnapshot } from '@/types/study';

/** A fixed local "now" (Tuesday 10 Nov 2026, 12:00) so date-dependent logic is deterministic. */
export const NOW = new Date(2026, 10, 10, 12, 0, 0);
export const TODAY = toISODate(NOW);

export function freezeClock(at: Date = NOW) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
}

export function at(day: number, hour: number, minute = 0, month = 10): Date {
  return new Date(2026, month, day, hour, minute, 0);
}

export function snapshotOf(state: ReturnType<typeof useStudyStore.getState>): StudyDataSnapshot {
  return {
    settings: state.settings, chapters: state.chapters, sessions: state.sessions, revisions: state.revisions,
    focusLog: state.focusLog, mockExams: state.mockExams, practiceLog: state.practiceLog, meta: state.meta,
  };
}

/** Puts both stores into a known state, independent of anything stored in the browser. */
export function resetStores(today: string = TODAY) {
  useStudyStore.setState(createSeedData(today));
  useTimerStore.setState({
    mode: 'pomodoro', phase: 'focus', status: 'idle', runStartedAt: null, accumulatedMs: 0, sessionKey: null,
    focusMsByDate: {}, completedFocusCount: 0, subjectId: 'p8', chapterId: 'p8-3', notes: '', plannedSessionId: null,
  });
}

export const chapter = (id: string) => useStudyStore.getState().chapters.find((c) => c.id === id)!;
export const revisionsOf = (chapterId: string) => useStudyStore.getState().revisions.filter((r) => r.chapterId === chapterId);
