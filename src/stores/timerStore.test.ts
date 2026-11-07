import { beforeEach, describe, expect, it } from 'vitest';
import { validateConsistency } from '@/lib/seedValidation';
import { useStudyStore } from '@/stores/studyStore';
import { elapsedMs, phaseDurationMs, useTimerStore } from '@/stores/timerStore';
import { at, chapter, freezeClock, resetStores, snapshotOf } from '@/test/helpers';

const timer = () => useTimerStore.getState();
const focusFor = (key: string) => useStudyStore.getState().focusLog.filter((r) => r.id === `focus-${key}` || r.id.startsWith(`focus-${key}@`));
const total = (rs: Array<{ minutes: number }>) => rs.reduce((s, r) => s + r.minutes, 0);

beforeEach(() => {
  freezeClock(at(10, 12));
  resetStores();
});

describe('basic flow', () => {
  it('counts down from the configured focus length using timestamps', () => {
    timer().start();
    const s = useTimerStore.getState();
    expect(s.status).toBe('running');
    const duration = phaseDurationMs(s, useStudyStore.getState().settings) as number;
    expect(duration - elapsedMs(s, at(10, 12, 20).getTime())).toBe(30 * 60_000);
  });

  it('cannot start without a chapter', () => {
    useTimerStore.setState({ chapterId: '' });
    timer().start();
    expect(timer().status).toBe('idle');
  });

  it('locks the subject and chapter while a focus block is running', () => {
    timer().start();
    timer().setTarget('p5', 'p5-1');
    expect(timer().chapterId).toBe('p8-3');
  });

  it('only changes mode while idle', () => {
    timer().start();
    timer().setMode('stopwatch');
    expect(timer().mode).toBe('pomodoro');
  });
});

describe('completion and recovery', () => {
  it('logs exactly the focus length when the block ends, then starts a short break', () => {
    timer().start();
    const key = timer().sessionKey as string;
    freezeClock(at(10, 12, 51));
    timer().completeIfElapsed();
    expect(total(focusFor(key))).toBe(50);
    expect(timer()).toMatchObject({ phase: 'short_break', status: 'running', completedFocusCount: 1, sessionKey: null });
  });

  it('does nothing before the time is up', () => {
    timer().start();
    freezeClock(at(10, 12, 30));
    timer().completeIfElapsed();
    expect(timer().phase).toBe('focus');
    expect(useStudyStore.getState().focusLog.some((r) => r.id.startsWith('focus-'))).toBe(false);
  });

  it('recovers a block that expired while the app was closed, logging the planned length, not the downtime', () => {
    useTimerStore.setState({ status: 'running', runStartedAt: at(10, 9).getTime(), accumulatedMs: 0, sessionKey: 'recover1', focusMsByDate: {} });
    freezeClock(at(10, 15));
    timer().completeIfElapsed();
    expect(total(focusFor('recover1'))).toBe(50);
  });

  it('survives a simulated refresh: the persisted state alone is enough to finish and log once', () => {
    timer().start();
    const persisted = JSON.parse(JSON.stringify(useTimerStore.getState()));
    freezeClock(at(10, 13));
    useTimerStore.setState({ ...persisted });
    timer().completeIfElapsed();
    timer().completeIfElapsed();
    expect(total(focusFor(persisted.sessionKey))).toBe(50);
  });

  it('never logs the same block twice, even if both tabs complete it', () => {
    timer().start();
    const snapshot = { ...useTimerStore.getState() };
    const key = snapshot.sessionKey as string;
    freezeClock(at(10, 13));
    timer().completeIfElapsed();
    const hours = chapter('p8-3').actualHours;
    // A second tab still holds the pre-completion state and finishes the same block.
    useTimerStore.setState({ ...snapshot });
    timer().completeIfElapsed();
    expect(focusFor(key)).toHaveLength(1);
    expect(chapter('p8-3').actualHours).toBeCloseTo(hours, 9);
  });

  it('a skipped or finished break logs nothing', () => {
    timer().start();
    freezeClock(at(10, 12, 51));
    timer().completeIfElapsed();
    const count = useStudyStore.getState().focusLog.length;
    freezeClock(at(10, 13, 5));
    timer().completeIfElapsed();
    expect(timer()).toMatchObject({ phase: 'focus', status: 'idle' });
    expect(useStudyStore.getState().focusLog).toHaveLength(count);
  });

  it('takes a long break after the configured number of focus blocks', () => {
    useTimerStore.setState({ completedFocusCount: 3 });
    timer().start();
    freezeClock(at(10, 12, 51));
    timer().completeIfElapsed();
    expect(timer().phase).toBe('long_break');
  });

  it('skipBreak returns to an idle focus phase', () => {
    useTimerStore.setState({ phase: 'short_break', status: 'running', runStartedAt: Date.now() });
    timer().skipBreak();
    expect(timer()).toMatchObject({ phase: 'focus', status: 'idle' });
  });
});

describe('focused time accounting', () => {
  it('excludes paused time', () => {
    timer().start();
    const key = timer().sessionKey as string;
    freezeClock(at(10, 12, 10));
    timer().pause();
    freezeClock(at(10, 12, 40));
    timer().start();
    freezeClock(at(10, 12, 55));
    timer().finish();
    expect(total(focusFor(key))).toBe(25);
    expect(timer().status).toBe('idle');
  });

  it('logs nothing for a block shorter than a minute', () => {
    timer().start();
    freezeClock(at(10, 12, 0));
    timer().finish();
    expect(useStudyStore.getState().focusLog.some((r) => r.id.startsWith('focus-'))).toBe(false);
  });

  it('reset discards the block without logging', () => {
    timer().start();
    freezeClock(at(10, 12, 20));
    timer().reset();
    expect(useStudyStore.getState().focusLog.some((r) => r.id.startsWith('focus-'))).toBe(false);
    expect(timer().status).toBe('idle');
  });

  it('stopwatch mode logs whatever was actually focused', () => {
    useTimerStore.setState({ mode: 'stopwatch' });
    timer().start();
    const key = timer().sessionKey as string;
    freezeClock(at(10, 13, 17));
    timer().finish();
    expect(total(focusFor(key))).toBe(77);
  });

  it('marks the linked planned session in progress, then completed, without double counting', () => {
    useTimerStore.setState({ plannedSessionId: 's-3' });
    timer().start();
    expect(useStudyStore.getState().sessions.find((s) => s.id === 's-3')?.status).toBe('in_progress');
    freezeClock(at(10, 12, 51));
    timer().completeIfElapsed();
    expect(useStudyStore.getState().sessions.find((s) => s.id === 's-3')?.status).toBe('completed');
    expect(useStudyStore.getState().focusLog.filter((r) => r.sessionId === 's-3')).toHaveLength(1);
  });
});

describe('blocks that cross midnight', () => {
  it('splits a pomodoro across both days and keeps the total unchanged', () => {
    freezeClock(at(10, 23, 40));
    timer().start();
    const key = timer().sessionKey as string;
    freezeClock(at(11, 0, 31));
    timer().completeIfElapsed();
    const records = focusFor(key).sort((a, b) => a.date.localeCompare(b.date));
    expect(records.map((r) => [r.date, r.minutes])).toEqual([['2026-11-10', 20], ['2026-11-11', 30]]);
    expect(total(records)).toBe(50);
  });

  it('splits a stopwatch session that ends after midnight', () => {
    useTimerStore.setState({ mode: 'stopwatch' });
    freezeClock(at(10, 23, 0));
    timer().start();
    const key = timer().sessionKey as string;
    freezeClock(at(11, 1, 30));
    timer().finish();
    const records = focusFor(key).sort((a, b) => a.date.localeCompare(b.date));
    expect(records.map((r) => [r.date, r.minutes])).toEqual([['2026-11-10', 60], ['2026-11-11', 90]]);
  });

  it('attributes paused gaps correctly when the pause itself spans midnight', () => {
    freezeClock(at(10, 23, 40));
    timer().start();
    const key = timer().sessionKey as string;
    freezeClock(at(10, 23, 50));
    timer().pause();
    freezeClock(at(11, 8, 0));
    timer().start();
    freezeClock(at(11, 8, 20));
    timer().finish();
    const records = focusFor(key).sort((a, b) => a.date.localeCompare(b.date));
    expect(records.map((r) => [r.date, r.minutes])).toEqual([['2026-11-10', 10], ['2026-11-11', 20]]);
  });

  it('is idempotent across a midnight block: completing twice adds nothing', () => {
    freezeClock(at(10, 23, 40));
    timer().start();
    const snapshot = { ...useTimerStore.getState() };
    const key = snapshot.sessionKey as string;
    freezeClock(at(11, 0, 31));
    timer().completeIfElapsed();
    const count = focusFor(key).length;
    useTimerStore.setState({ ...snapshot });
    timer().completeIfElapsed();
    expect(focusFor(key)).toHaveLength(count);
    expect(total(focusFor(key))).toBe(50);
  });

  it('keeps chapter hours equal to the focus history after a midnight block', () => {
    freezeClock(at(10, 23, 40));
    timer().start();
    freezeClock(at(11, 0, 31));
    timer().completeIfElapsed();
    expect(validateConsistency(snapshotOf(useStudyStore.getState()))).toEqual([]);
  });

  it('attributes the end of a block that is only recovered long after midnight to the right days', () => {
    useTimerStore.setState({ status: 'running', runStartedAt: at(10, 23, 40).getTime(), accumulatedMs: 0, sessionKey: 'late', focusMsByDate: {} });
    freezeClock(at(12, 9, 0));
    timer().completeIfElapsed();
    const records = focusFor('late').sort((a, b) => a.date.localeCompare(b.date));
    expect(records.map((r) => [r.date, r.minutes])).toEqual([['2026-11-10', 20], ['2026-11-11', 30]]);
  });

  it('falls back to a single day for timer state saved before per-day tracking existed', () => {
    useTimerStore.setState({ status: 'running', runStartedAt: at(10, 11, 0).getTime(), accumulatedMs: 0, sessionKey: 'old', focusMsByDate: {} });
    timer().completeIfElapsed();
    expect(total(focusFor('old'))).toBe(50);
    expect(focusFor('old')[0].date).toBe('2026-11-10');
  });
});
