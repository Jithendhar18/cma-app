import { toISODate } from '@/lib/dates';

const MIN = 60_000;

/** Local-time start of the day after the one containing `ms`. DST-safe (uses calendar math). */
function nextMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Splits [startMs, endMs) at local midnights. Returns milliseconds per ISO date. */
export function splitIntervalByDay(startMs: number, endMs: number): Record<string, number> {
  const result: Record<string, number> = {};
  let cursor = startMs;
  while (cursor < endMs) {
    const boundary = Math.min(endMs, nextMidnight(cursor));
    const date = toISODate(new Date(cursor));
    result[date] = (result[date] ?? 0) + (boundary - cursor);
    cursor = boundary;
  }
  return result;
}

export function sumMs(byDate: Record<string, number>): number {
  return Object.values(byDate).reduce((a, b) => a + b, 0);
}

export function mergeMs(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [date, ms] of Object.entries(b)) out[date] = (out[date] ?? 0) + ms;
  return out;
}

/**
 * Converts exact milliseconds per day into whole minutes per day. The minute total always equals
 * round(totalMs / 60000): fractions are distributed by largest remainder so nothing is lost or
 * invented at a midnight boundary. Days that end up with zero minutes are dropped.
 */
export function allocateMinutes(byDate: Record<string, number>): Array<{ date: string; minutes: number }> {
  const entries = Object.entries(byDate)
    .filter(([, ms]) => ms > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const target = Math.round(sumMs(byDate) / MIN);
  const rows = entries.map(([date, ms]) => ({ date, minutes: Math.floor(ms / MIN), frac: (ms / MIN) % 1 }));
  let remaining = target - rows.reduce((s, r) => s + r.minutes, 0);
  const byFrac = [...rows].sort((a, b) => b.frac - a.frac);
  for (let i = 0; remaining > 0 && byFrac.length > 0; i = (i + 1) % byFrac.length) {
    byFrac[i].minutes += 1;
    remaining -= 1;
  }
  return rows.filter((r) => r.minutes > 0).map(({ date, minutes }) => ({ date, minutes }));
}

/** A planned session (date + HH:MM start + duration) expressed as minutes per calendar day. */
export function splitPlannedSession(date: string, startTime: string, durationMinutes: number) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = startTime.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm).getTime();
  return allocateMinutes(splitIntervalByDay(start, start + durationMinutes * MIN));
}
