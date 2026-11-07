import { describe, expect, it } from 'vitest';
import { createSeedData } from '@/data/seed';
import { rollDemoForward } from '@/lib/demoRoll';
import { addDaysISO } from '@/lib/dates';
import { validateConsistency } from '@/lib/seedValidation';
import type { StudyDataSnapshot } from '@/types/study';

const ANCHOR = '2026-11-10';
const LATER = '2026-11-15';

function withUserData(): StudyDataSnapshot {
  const seed = createSeedData(ANCHOR);
  return {
    ...seed,
    sessions: [...seed.sessions, { id: 's-user', date: ANCHOR, subjectId: 'p5', chapterId: 'p5-1', startTime: '09:00', durationMinutes: 45, status: 'completed', priority: 'low', notes: 'mine' }],
    focusLog: [...seed.focusLog, { id: 'focus-user', date: ANCHOR, subjectId: 'p5', chapterId: 'p5-1', minutes: 45, mode: 'pomodoro', notes: '', sessionId: null }],
  };
}

describe('rollDemoForward', () => {
  it('moves untouched demo sessions so "today" stays today', () => {
    const rolled = rollDemoForward(createSeedData(ANCHOR), LATER);
    const todays = rolled.sessions.filter((s) => s.date === LATER);
    expect(todays.map((s) => s.id).sort()).toEqual(['s-1', 's-2', 's-3', 's-4']);
    expect(rolled.sessions.some((s) => s.date === ANCHOR)).toBe(false);
  });

  it('never moves records the user created', () => {
    const rolled = rollDemoForward(withUserData(), LATER);
    expect(rolled.sessions.find((s) => s.id === 's-user')).toMatchObject({ date: ANCHOR, notes: 'mine' });
    expect(rolled.focusLog.find((r) => r.id === 'focus-user')?.date).toBe(ANCHOR);
  });

  it('never moves demo records the user has since edited (flag cleared)', () => {
    const data = createSeedData(ANCHOR);
    data.sessions = data.sessions.map((s) => (s.id === 's-3' ? { ...s, demo: false, status: 'completed' as const } : s));
    const rolled = rollDemoForward(data, LATER);
    expect(rolled.sessions.find((s) => s.id === 's-3')?.date).toBe(ANCHOR);
    expect(rolled.sessions.find((s) => s.id === 's-4')?.date).toBe(LATER);
  });

  it('preserves spacing, counts and consistency, and creates no duplicates', () => {
    const seed = createSeedData(ANCHOR);
    const rolled = rollDemoForward(seed, LATER);
    expect(rolled.focusLog).toHaveLength(seed.focusLog.length);
    expect(rolled.sessions).toHaveLength(seed.sessions.length);
    expect(rolled.revisions).toHaveLength(seed.revisions.length);
    expect(new Set(rolled.focusLog.map((r) => r.id)).size).toBe(rolled.focusLog.length);
    expect(validateConsistency(rolled)).toEqual([]);
    rolled.focusLog.forEach((r, i) => expect(r.date).toBe(addDaysISO(seed.focusLog[i].date, 5)));
  });

  it('shifts revision due and completion dates together', () => {
    const rolled = rollDemoForward(createSeedData(ANCHOR), LATER);
    const first = rolled.revisions.find((r) => r.id === 'rev-1');
    expect(first?.dueDate).toBe(LATER);
    const done = rolled.revisions.find((r) => r.id === 'rev-8');
    expect(done?.completedOn).toBe(addDaysISO(LATER, -2));
  });

  it('is idempotent: rolling again to the same day changes nothing', () => {
    const once = rollDemoForward(createSeedData(ANCHOR), LATER);
    expect(once.meta.seedAnchor).toBe(LATER);
    expect(rollDemoForward(once, LATER)).toBe(once);
  });

  it('does nothing without an anchor or when the date has not advanced', () => {
    const seed = createSeedData(ANCHOR);
    expect(rollDemoForward({ ...seed, meta: { seedAnchor: null } }, LATER).sessions).toEqual(seed.sessions);
    expect(rollDemoForward(seed, ANCHOR)).toBe(seed);
    expect(rollDemoForward(seed, '2026-11-01')).toBe(seed);
  });

  it('keeps the settings, including the placeholder exam date, untouched', () => {
    const rolled = rollDemoForward(createSeedData(ANCHOR), LATER);
    expect(rolled.settings).toEqual(createSeedData(ANCHOR).settings);
  });
});
