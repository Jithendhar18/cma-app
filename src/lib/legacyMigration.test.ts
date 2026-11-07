import { describe, expect, it } from 'vitest';
import { createSeedData } from '@/data/seed';
import { CHAPTER_SEEDS, SUBJECTS } from '@/data/subjects';
import { addDaysISO } from '@/lib/dates';
import { inferSeedAnchor, upgradeLegacySnapshot } from '@/lib/legacyMigration';
import { loadSnapshot } from '@/lib/loadSnapshot';
import type { StudyDataSnapshot } from '@/types/study';

const ANCHOR = '2026-11-02';
const TODAY = '2026-11-10';

/** Data as saved by the previous version: no meta, no demo flags. */
function legacyData(): Record<string, unknown> {
  const seed = createSeedData(ANCHOR);
  const strip = (r: object) => {
    const copy: Record<string, unknown> = { ...r };
    delete copy.demo;
    delete copy.cancelledOn;
    return copy;
  };
  return {
    settings: seed.settings,
    // The old seed's chapter numbers came straight from the sample table.
    chapters: seed.chapters.map((c) => {
      const t = SUBJECTS.flatMap((s) => (CHAPTER_SEEDS[s.id] ?? []).map((row, i) => ({ id: `${s.id}-${i + 1}`, row }))).find((x) => x.id === c.id)!.row;
      const [, , status, confidence, hours, questions, accuracy, daysAgo] = t;
      return strip({ ...c, status, confidence, actualHours: hours, questionsPracticed: questions, correctAnswers: Math.round((questions * accuracy) / 100), lastStudied: daysAgo === null ? null : addDaysISO(ANCHOR, -daysAgo) });
    }),
    sessions: seed.sessions.map(strip),
    revisions: seed.revisions.slice(0, 10).map(strip),
    focusLog: seed.focusLog.map(strip),
    mockExams: seed.mockExams.map(strip),
    practiceLog: seed.practiceLog.map(strip),
  };
}

describe('inferSeedAnchor', () => {
  it('recovers the date the demo was generated on', () => {
    expect(inferSeedAnchor((legacyData().focusLog as StudyDataSnapshot['focusLog']))).toBe(ANCHOR);
  });

  it('refuses to guess when there is too little or conflicting evidence', () => {
    expect(inferSeedAnchor([{ id: 'focus-1', date: ANCHOR }])).toBeNull();
    const conflicting = Array.from({ length: 10 }, (_, i) => ({ id: `f-${i}-0`, date: addDaysISO(ANCHOR, -i - (i % 2 ? 3 : 0)) }));
    expect(inferSeedAnchor(conflicting)).toBeNull();
  });
});

describe('upgradeLegacySnapshot', () => {
  it('flags untouched demo content and records the anchor', () => {
    const upgraded = upgradeLegacySnapshot(legacyData()) as StudyDataSnapshot;
    expect(upgraded.meta.seedAnchor).toBe(ANCHOR);
    expect(upgraded.sessions.every((s) => s.demo)).toBe(true);
    expect(upgraded.focusLog.every((r) => r.demo)).toBe(true);
    expect(upgraded.chapters.every((c) => c.demo)).toBe(true);
    expect(upgraded.revisions.every((r) => r.demo)).toBe(true);
  });

  it('leaves anything the user changed unflagged', () => {
    const raw = legacyData() as Record<string, unknown[]>;
    raw.sessions = (raw.sessions as StudyDataSnapshot['sessions']).map((s) => (s.id === 's-3' ? { ...s, status: 'completed' } : s));
    raw.chapters = (raw.chapters as StudyDataSnapshot['chapters']).map((c) => (c.id === 'p5-1' ? { ...c, notes: 'my own notes' } : c));
    raw.revisions = (raw.revisions as StudyDataSnapshot['revisions']).map((r) => (r.id === 'rev-1' ? { ...r, completedOn: ANCHOR } : r));
    const upgraded = upgradeLegacySnapshot(raw) as StudyDataSnapshot;
    expect(upgraded.sessions.find((s) => s.id === 's-3')?.demo).toBeUndefined();
    expect(upgraded.sessions.find((s) => s.id === 's-4')?.demo).toBe(true);
    expect(upgraded.chapters.find((c) => c.id === 'p5-1')?.demo).toBeUndefined();
    expect(upgraded.revisions.find((r) => r.id === 'rev-1')?.demo).toBeUndefined();
  });

  it('adds records the user created without touching them', () => {
    const raw = legacyData() as Record<string, unknown[]>;
    raw.sessions = [...raw.sessions, { id: 's-mine', date: ANCHOR, subjectId: 'p5', chapterId: 'p5-1', startTime: '07:00', durationMinutes: 30, status: 'upcoming', priority: 'low', notes: '' }];
    const upgraded = upgradeLegacySnapshot(raw) as StudyDataSnapshot;
    expect(upgraded.sessions.find((s) => s.id === 's-mine')).toEqual((raw.sessions as StudyDataSnapshot['sessions']).find((s) => s.id === 's-mine'));
  });

  it('adds nothing but flags and meta: every value the user could have edited is preserved', () => {
    const raw = legacyData();
    const upgraded = upgradeLegacySnapshot(raw) as StudyDataSnapshot;
    const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, val) => (k === 'demo' ? undefined : val)));
    expect(strip(upgraded.sessions)).toEqual(strip(raw.sessions));
    expect(strip(upgraded.chapters)).toEqual(strip(raw.chapters));
    expect(strip(upgraded.settings)).toEqual(strip(raw.settings));
  });

  it('returns invalid input unchanged and treats unrecognisable data as having no demo content', () => {
    expect(upgradeLegacySnapshot({ nope: true })).toEqual({ nope: true });
    const noDemo = { ...legacyData(), focusLog: [] };
    expect((upgradeLegacySnapshot(noDemo) as StudyDataSnapshot).meta.seedAnchor).toBeNull();
  });
});

describe('loadSnapshot', () => {
  it('upgrades old data and rolls untouched demo content forward, keeping user records in place', () => {
    const raw = legacyData() as Record<string, unknown[]>;
    raw.sessions = [...raw.sessions, { id: 's-mine', date: ANCHOR, subjectId: 'p5', chapterId: 'p5-1', startTime: '07:00', durationMinutes: 30, status: 'upcoming', priority: 'low', notes: '' }];
    const result = loadSnapshot(raw, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.find((s) => s.id === 's-1')?.date).toBe(TODAY);
    expect(result.data.sessions.find((s) => s.id === 's-mine')?.date).toBe(ANCHOR);
    expect(result.data.meta.seedAnchor).toBe(TODAY);
  });

  it('is stable when loaded repeatedly', () => {
    const first = loadSnapshot(legacyData(), TODAY);
    if (!first.ok) throw new Error('expected ok');
    const second = loadSnapshot(first.data, TODAY);
    expect(second.ok && second.data).toEqual(first.data);
  });

  it('reports a clear error instead of throwing on junk', () => {
    expect(loadSnapshot(42, TODAY).ok).toBe(false);
    expect(loadSnapshot(null, TODAY).ok).toBe(false);
    expect(loadSnapshot({ settings: 1 }, TODAY).ok).toBe(false);
  });
});
