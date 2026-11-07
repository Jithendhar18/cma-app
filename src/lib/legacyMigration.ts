import { CHAPTER_SEEDS, SUBJECTS, type ChapterSeed } from '@/data/subjects';
import { CHAPTER_NOTES, createSeedData } from '@/data/seed';
import { addDaysISO } from '@/lib/dates';
import { parseSnapshot } from '@/lib/snapshot';

type Rec = Record<string, unknown>;

const withoutDemo = (r: object): Rec => {
  const copy = { ...(r as Rec) };
  delete copy.demo;
  return copy;
};
const same = (a: object, b: object) => JSON.stringify(sortKeys(withoutDemo(a))) === JSON.stringify(sortKeys(withoutDemo(b)));
function sortKeys(o: Rec): Rec {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/**
 * The date the demo data was generated on, inferred from demo focus-record ids (`f-<days>-<n>`),
 * which users cannot edit. Returns null unless the vast majority agree.
 */
export function inferSeedAnchor(focusLog: Array<{ id: string; date: string }>): string | null {
  const votes = new Map<string, number>();
  let total = 0;
  for (const r of focusLog) {
    const m = /^f-(\d+)-\d+$/.exec(r.id);
    if (!m) continue;
    total += 1;
    const anchor = addDaysISO(r.date, Number(m[1]));
    votes.set(anchor, (votes.get(anchor) ?? 0) + 1);
  }
  if (total < 5) return null;
  const [best, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return count / total >= 0.8 ? best : null;
}

/**
 * Upgrades data saved before demo tracking existed. It is strictly additive: it adds `demo` flags and
 * `meta`, and never changes a value the user could have edited. A record is only flagged when it is
 * recognisably the untouched sample. Anything that differs is left alone as the user's own data.
 *
 * Returns the input unchanged when it is not a valid snapshot or has no recognisable demo content.
 */
export function upgradeLegacySnapshot(raw: unknown): unknown {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) return raw;
  const data = parsed.data;
  const anchor = inferSeedAnchor(data.focusLog);
  if (!anchor) return { ...(raw as Rec), meta: { seedAnchor: null } };

  const seed = createSeedData(anchor);
  const seedSessions = new Map(seed.sessions.map((s) => [s.id, s]));
  const seedRevisions = new Map(seed.revisions.slice(0, 10).map((r) => [r.id, r]));
  const seedMocks = new Map(seed.mockExams.map((m) => [m.id, m]));
  const tuples = new Map<string, ChapterSeed>(
    SUBJECTS.flatMap((s) => (CHAPTER_SEEDS[s.id] ?? []).map((t, i): [string, ChapterSeed] => [`${s.id}-${i + 1}`, t])),
  );

  const flagged = {
    ...data,
    sessions: data.sessions.map((s) => (seedSessions.has(s.id) && same(s, seedSessions.get(s.id)!) ? { ...s, demo: true } : s)),
    revisions: data.revisions.map((r) => (seedRevisions.has(r.id) && same(r, seedRevisions.get(r.id)!) ? { ...r, demo: true } : r)),
    mockExams: data.mockExams.map((m) => (seedMocks.has(m.id) && same(m, seedMocks.get(m.id)!) ? { ...m, demo: true } : m)),
    focusLog: data.focusLog.map((r) => {
      const m = /^f-(\d+)-\d+$/.exec(r.id);
      const isDemo = r.id === 'f-today-s1' ? r.date === anchor : m !== null && r.date === addDaysISO(anchor, -Number(m[1]));
      return isDemo ? { ...r, demo: true } : r;
    }),
    practiceLog: data.practiceLog.map((r) => (/^pr-p\d+-\d+-\d$/.test(r.id) ? { ...r, demo: true } : r)),
    chapters: data.chapters.map((c) => {
      const t = tuples.get(c.id);
      if (!t) return c;
      const [, , status, confidence, hours, questions, accuracy, daysAgo] = t;
      const untouched =
        c.status === status &&
        c.notes === (CHAPTER_NOTES[c.id] ?? '') &&
        c.confidence === confidence &&
        Math.abs(c.actualHours - hours) < 1e-9 &&
        c.questionsPracticed === questions &&
        c.correctAnswers === Math.round((questions * accuracy) / 100) &&
        c.lastStudied === (daysAgo === null ? null : addDaysISO(anchor, -daysAgo));
      return untouched ? { ...c, demo: true } : c;
    }),
    meta: { seedAnchor: anchor },
  };
  return flagged;
}
