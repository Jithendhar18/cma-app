import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { todayISO } from '@/lib/dates';
import { createSafeStorage } from '@/lib/safeStorage';
import { allocateMinutes, mergeMs, splitIntervalByDay, sumMs } from '@/lib/focusSplit';
import { useStudyStore } from '@/stores/studyStore';
import type { Settings } from '@/types/study';

export type TimerMode = 'pomodoro' | 'stopwatch';
export type TimerPhase = 'focus' | 'short_break' | 'long_break';
export type TimerStatus = 'idle' | 'running' | 'paused';

/**
 * Timestamp-based timer. Elapsed time is always derived from `runStartedAt` and
 * `accumulatedMs`, never from counting interval ticks, so it survives throttled
 * tabs, navigation and page refreshes (the whole state is persisted).
 */
interface TimerState {
  mode: TimerMode;
  phase: TimerPhase;
  status: TimerStatus;
  runStartedAt: number | null;
  accumulatedMs: number;
  /** Unique per focus block; doubles as the idempotency key for logging. */
  sessionKey: string | null;
  /** Focused milliseconds of the current block per calendar date, so blocks can span midnight. */
  focusMsByDate: Record<string, number>;
  completedFocusCount: number;
  subjectId: string;
  chapterId: string;
  notes: string;
  plannedSessionId: string | null;
}

interface TimerActions {
  setMode: (mode: TimerMode) => void;
  setTarget: (subjectId: string, chapterId: string, plannedSessionId?: string | null) => void;
  setNotes: (notes: string) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  /** Logs focused time so far and returns to an idle focus phase. */
  finish: () => void;
  skipBreak: () => void;
  /** Called by the engine; completes the current pomodoro phase if its time is up. */
  completeIfElapsed: () => void;
}

export type TimerStore = TimerState & TimerActions;

const MIN = 60_000;

export function phaseDurationMs(state: Pick<TimerState, 'mode' | 'phase'>, s: Settings): number | null {
  if (state.mode === 'stopwatch') return null;
  if (state.phase === 'focus') return s.pomodoroFocusMinutes * MIN;
  return (state.phase === 'short_break' ? s.shortBreakMinutes : s.longBreakMinutes) * MIN;
}

export function elapsedMs(state: Pick<TimerState, 'status' | 'runStartedAt' | 'accumulatedMs'>, now: number): number {
  const live = state.status === 'running' && state.runStartedAt !== null ? Math.max(0, now - state.runStartedAt) : 0;
  return state.accumulatedMs + live;
}

const idleBase = {
  phase: 'focus' as TimerPhase,
  status: 'idle' as TimerStatus,
  runStartedAt: null,
  accumulatedMs: 0,
  sessionKey: null,
  focusMsByDate: {} as Record<string, number>,
};

/** The running segment of a focus block, attributed to the calendar days it covers. */
function withSegment(state: TimerState, endMs: number): Record<string, number> {
  if (state.phase !== 'focus' || state.status !== 'running' || state.runStartedAt === null) return state.focusMsByDate;
  return mergeMs(state.focusMsByDate, splitIntervalByDay(state.runStartedAt, Math.max(state.runStartedAt, endMs)));
}

/**
 * Logs one focus record per calendar day the block covered. Whole minutes are allocated so the
 * total equals the block's real duration. Record ids are derived from the block's key and date, so
 * logging the same block twice (refresh, second tab) can never create duplicates.
 */
function logFocus(state: TimerState, byDate: Record<string, number>, totalMs: number) {
  if (state.phase !== 'focus' || !state.sessionKey) return;
  // Older saved timers have no per-day breakdown: attribute everything to today.
  const usable = Math.abs(sumMs(byDate) - totalMs) < 2000 ? byDate : { [todayISO()]: totalMs };
  const parts = allocateMinutes(usable);
  parts.forEach((part, i) => {
    useStudyStore.getState().addFocusRecord({
      id: i === 0 ? `focus-${state.sessionKey}` : `focus-${state.sessionKey}@${part.date}`,
      date: part.date,
      subjectId: state.subjectId,
      chapterId: state.chapterId,
      minutes: part.minutes,
      mode: state.mode,
      notes: state.notes.trim(),
      sessionId: state.plannedSessionId,
    });
  });
}

const firstChapter = () => {
  const chapter = useStudyStore.getState().chapters.find((c) => c.status !== 'completed' && c.status !== 'exam_ready');
  const fallback = useStudyStore.getState().chapters[0];
  const pick = chapter ?? fallback;
  return { subjectId: pick?.subjectId ?? '', chapterId: pick?.id ?? '' };
};

export const useTimerStore = create<TimerStore>()(
  persist(
    (set, get) => ({
      mode: 'pomodoro',
      ...idleBase,
      completedFocusCount: 0,
      ...firstChapter(),
      notes: '',
      plannedSessionId: null,

      setMode: (mode) => {
        if (get().status !== 'idle') return;
        set({ mode, ...idleBase });
      },

      setTarget: (subjectId, chapterId, plannedSessionId = null) => {
        const state = get();
        // A running block keeps the subject it was started with.
        if (state.status !== 'idle' && state.phase === 'focus') return;
        set({ subjectId, chapterId, plannedSessionId });
      },

      setNotes: (notes) => set({ notes }),

      start: () => {
        const state = get();
        const now = Date.now();
        if (state.status === 'running') return;
        if (state.status === 'paused') {
          set({ status: 'running', runStartedAt: now });
          return;
        }
        if (!state.chapterId && state.phase === 'focus') return;
        set({
          status: 'running',
          runStartedAt: now,
          accumulatedMs: 0,
          focusMsByDate: {},
          sessionKey: state.phase === 'focus' ? `${now}` : null,
        });
        const planned = state.plannedSessionId;
        if (planned && state.phase === 'focus') {
          useStudyStore.getState().updateSession(planned, { status: 'in_progress' });
        }
      },

      pause: () => {
        const state = get();
        if (state.status !== 'running') return;
        const now = Date.now();
        set({ status: 'paused', accumulatedMs: elapsedMs(state, now), runStartedAt: null, focusMsByDate: withSegment(state, now) });
      },

      reset: () => {
        const planned = get().plannedSessionId;
        const state = get();
        if (planned && state.phase === 'focus' && state.status !== 'idle') {
          const session = useStudyStore.getState().sessions.find((s) => s.id === planned);
          if (session?.status === 'in_progress') useStudyStore.getState().updateSession(planned, { status: 'upcoming' });
        }
        set({ ...idleBase });
      },

      finish: () => {
        const state = get();
        if (state.status === 'idle') return;
        const now = Date.now();
        logFocus(state, withSegment(state, now), elapsedMs(state, now));
        set({ ...idleBase, plannedSessionId: null });
      },

      skipBreak: () => {
        if (get().phase === 'focus') return;
        set({ ...idleBase });
      },

      completeIfElapsed: () => {
        const state = get();
        if (state.mode !== 'pomodoro' || state.status !== 'running') return;
        const total = phaseDurationMs(state, useStudyStore.getState().settings);
        if (total === null || elapsedMs(state, Date.now()) < total) return;

        if (state.phase !== 'focus') {
          set({ ...idleBase });
          return;
        }
        // Log exactly the planned focus length, regardless of how late the tick ran. The last segment
        // ends when the phase should have ended, not when this tick happened to fire.
        const endedAt = (state.runStartedAt ?? Date.now()) + (total - state.accumulatedMs);
        logFocus(state, withSegment(state, endedAt), total);
        const settings = useStudyStore.getState().settings;
        const count = state.completedFocusCount + 1;
        const nextPhase: TimerPhase = count % settings.longBreakEvery === 0 ? 'long_break' : 'short_break';
        set({
          completedFocusCount: count,
          phase: nextPhase,
          status: 'running',
          runStartedAt: Date.now(),
          accumulatedMs: 0,
          sessionKey: null,
          focusMsByDate: {},
          plannedSessionId: null,
        });
      },
    }),
    {
      name: 'cma-study-os-timer',
      version: 1,
      storage: createJSONStorage(() => createSafeStorage()),
    },
  ),
);
