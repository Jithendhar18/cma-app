import { describe, expect, it } from 'vitest';
import { allocateMinutes, mergeMs, splitIntervalByDay, splitPlannedSession, sumMs } from '@/lib/focusSplit';
import { at } from '@/test/helpers';

const MIN = 60_000;

describe('splitIntervalByDay', () => {
  it('keeps an interval inside one day whole', () => {
    expect(splitIntervalByDay(at(10, 9).getTime(), at(10, 10).getTime())).toEqual({ '2026-11-10': 60 * MIN });
  });

  it('splits at local midnight and preserves the total', () => {
    const result = splitIntervalByDay(at(10, 23, 40).getTime(), at(11, 0, 30).getTime());
    expect(result).toEqual({ '2026-11-10': 20 * MIN, '2026-11-11': 30 * MIN });
    expect(sumMs(result)).toBe(50 * MIN);
  });

  it('handles an interval spanning several days', () => {
    const result = splitIntervalByDay(at(10, 22).getTime(), at(12, 2).getTime());
    expect(Object.keys(result)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(result['2026-11-11']).toBe(24 * 60 * MIN);
    expect(sumMs(result)).toBe(28 * 60 * MIN);
  });

  it('ends exactly on midnight without creating an empty next day', () => {
    expect(splitIntervalByDay(at(10, 23).getTime(), at(11, 0).getTime())).toEqual({ '2026-11-10': 60 * MIN });
  });

  it('returns nothing for an empty or reversed interval', () => {
    expect(splitIntervalByDay(5, 5)).toEqual({});
    expect(splitIntervalByDay(10, 5)).toEqual({});
  });
});

describe('allocateMinutes', () => {
  it('always totals round(totalMs / 60000), distributing fractions by largest remainder', () => {
    const byDate = { '2026-11-10': 20.5 * MIN, '2026-11-11': 29.5 * MIN };
    const parts = allocateMinutes(byDate);
    expect(parts.reduce((s, p) => s + p.minutes, 0)).toBe(50);
  });

  it('never loses a minute when both sides have fractions', () => {
    const byDate = { a: 10.4 * MIN, b: 10.4 * MIN, c: 10.4 * MIN };
    expect(allocateMinutes(byDate).reduce((s, p) => s + p.minutes, 0)).toBe(Math.round(31.2));
  });

  it('drops days that round to zero and keeps the rest ordered by date', () => {
    const parts = allocateMinutes({ '2026-11-11': 30 * MIN, '2026-11-10': 0.2 * MIN });
    expect(parts).toEqual([{ date: '2026-11-11', minutes: 30 }]);
  });

  it('is a no-op for whole-minute input', () => {
    expect(allocateMinutes({ '2026-11-10': 50 * MIN })).toEqual([{ date: '2026-11-10', minutes: 50 }]);
  });
});

describe('splitPlannedSession', () => {
  it('credits a 23:30 session of 90 minutes to both days', () => {
    expect(splitPlannedSession('2026-11-10', '23:30', 90)).toEqual([
      { date: '2026-11-10', minutes: 30 },
      { date: '2026-11-11', minutes: 60 },
    ]);
  });

  it('keeps an ordinary session on its own date', () => {
    expect(splitPlannedSession('2026-11-10', '18:00', 60)).toEqual([{ date: '2026-11-10', minutes: 60 }]);
  });
});

describe('mergeMs', () => {
  it('adds per-date totals', () => {
    expect(mergeMs({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 5, c: 4 });
  });
});
