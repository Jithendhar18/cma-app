import { describe, expect, it } from 'vitest';
import { FIXTURE_TREE, U } from '@/test/accountFixtures';
import { localIds, localWithOwnData } from '@/test/localFixtures';
import { createSeedData } from '@/data/seed';
import { snapshotToEntities } from '@/lib/sync/mappers';
import { entityId, isSingle, type ServerEntity } from '@/lib/sync/types';
import { buildImportPlan, EMPTY_MAPPING, fingerprint, localChaptersWithData, localSubjectsWithMocks, NO_EXCLUSIONS, type ImportMapping } from './importPlan';

const local = localWithOwnData();
const { c1, c2, subjectId } = localIds(local);
const [D1, D2] = FIXTURE_TREE.chapters;
const DRETIRED = FIXTURE_TREE.chapters.find((c) => c.retired)!;
const S1 = FIXTURE_TREE.subjects[0];
const FULL: ImportMapping = { chapters: { [c1]: D1.id, [c2]: D2.id }, subjects: { [subjectId]: S1.id } };
const plan = (over: Partial<Parameters<typeof buildImportPlan>[0]> = {}) => buildImportPlan({ local, destination: FIXTURE_TREE, mapping: FULL, excluded: NO_EXCLUSIONS, existing: [], ...over });
const counts = (p: ReturnType<typeof plan>) => Object.fromEntries(Object.entries(p.categories).map(([t, c]) => [t, [c.local, c.ready]]));

describe('what is importable', () => {
  it('imports only the student\'s own records: the sample data is excluded and not even counted', () => {
    const p = plan();
    expect(counts(p)).toEqual({ chapter_progress: [2, 2], planner_sessions: [1, 1], study_sessions: [3, 3], revisions: [1, 1], practice_records: [1, 1], mock_tests: [1, 1] });
    const keys = p.ready.map((e) => e.key);
    expect(keys.some((k) => /^(f|s|r|m|pr)-\d/.test(k) && !k.includes('own'))).toBe(false); // none of the seeded sample ids
    expect(JSON.stringify(p.ready)).not.toContain('"demo"');
  });
  it('a device with only sample data has nothing to import, and is not an error', () => {
    const p = buildImportPlan({ local: createSeedData('2026-11-08'), destination: FIXTURE_TREE, mapping: EMPTY_MAPPING, excluded: NO_EXCLUSIONS, existing: [] });
    expect(p.ready).toEqual([]);
    expect(p.unresolved).toEqual([]);
    expect(p.canImport).toBe(true);
    expect(p.nothingToDo).toBe(true);
  });
  it('lists the chapters and subjects that have data, never the sample-only ones', () => {
    expect(localChaptersWithData(local).map((c) => c.id).sort()).toEqual([c1, c2].sort());
    expect(localSubjectsWithMocks(local)).toEqual([{ id: subjectId, count: 1 }]);
  });
  it('writes the mapped destination ids, with the student\'s own local ids as the idempotency keys', () => {
    const p = plan();
    const focus = p.ready.find((e) => e.key === 'focus-own-1');
    expect(focus?.row).toMatchObject({ client_id: 'focus-own-1', chapter_id: D1.id });
    expect(p.ready.find((e) => e.table === 'mock_tests')?.row.subject_id).toBe(S1.id);
    expect(p.ready.some((e) => isSingle(e.table))).toBe(false); // name, settings and dates are never part of a record import
  });
});

describe('identity: nothing is matched by position, order or name', () => {
  it('leaves every chapter unmatched until the student matches it, even if a title is identical', () => {
    const lookalike = { ...FIXTURE_TREE, chapters: FIXTURE_TREE.chapters.map((c) => (c.id === D1.id ? { ...c, title: local.chapters.find((x) => x.id === c1)!.title } : c)) };
    const p = plan({ destination: lookalike, mapping: EMPTY_MAPPING });
    expect(p.canImport).toBe(false);
    expect(p.unresolved.filter((u) => u.kind === 'chapter').map((u) => u.localId).sort()).toEqual([c1, c2].sort());
    expect(p.ready.filter((e) => e.table !== 'mock_tests')).toEqual([]);
  });
  it('matches by id only when the local id IS a destination id', () => {
    // a backup that already carries account ids: rename the local chapter c1 (and every record that points at it) to D1's id
    const swap = <T extends { chapterId?: string }>(xs: T[]) => xs.map((x) => (x.chapterId === c1 ? { ...x, chapterId: D1.id } : x));
    const exactLocal = { ...local, chapters: local.chapters.map((c) => (c.id === c1 ? { ...c, id: D1.id } : c)), sessions: swap(local.sessions), focusLog: swap(local.focusLog), revisions: swap(local.revisions), practiceLog: swap(local.practiceLog) };
    const p = plan({ local: exactLocal, mapping: { chapters: { [c2]: D2.id }, subjects: FULL.subjects } });
    expect(p.unresolved).toEqual([]);
    expect(p.ready.find((e) => e.key === 'focus-own-1')?.row.chapter_id).toBe(D1.id);
  });
  it('does NOT treat a non-matching local id as a match, however similar the data looks', () => {
    const p = plan({ mapping: { chapters: {}, subjects: {} } });
    expect(p.ready).toEqual([]);
    expect(p.unresolved.length).toBeGreaterThan(0);
  });
  it('lists unmatched records with what depends on them, and blocks the import', () => {
    const p = plan({ mapping: { chapters: { [c1]: D1.id }, subjects: {} } });
    const ch = p.unresolved.find((u) => u.localId === c2)!;
    expect(ch.counts).toMatchObject({ chapter_progress: 1, study_sessions: 1, practice_records: 1 });
    expect(p.unresolved.find((u) => u.kind === 'subject')?.counts).toEqual({ mock_tests: 1 });
    expect(p.canImport).toBe(false);
    expect(p.issues.some((i) => i.reason === 'unmatched-chapter')).toBe(true);
  });
  it('refuses a retired destination chapter and a destination that is not in the course', () => {
    const retired = plan({ mapping: { chapters: { [c1]: DRETIRED.id, [c2]: D2.id }, subjects: FULL.subjects } });
    expect(retired.unresolved.find((u) => u.localId === c1)?.problem).toMatch(/retired/);
    expect(retired.canImport).toBe(false);
    const foreign = plan({ mapping: { chapters: { [c1]: U(99999), [c2]: D2.id }, subjects: FULL.subjects } });
    expect(foreign.unresolved.find((u) => u.localId === c1)?.problem).toMatch(/not in your course/);
  });
  it('allows the student to leave things out explicitly, and says so', () => {
    const p = plan({ mapping: { chapters: { [c1]: D1.id }, subjects: {} }, excluded: { chapters: [c2], subjects: [subjectId] } });
    expect(p.unresolved).toEqual([]);
    expect(p.canImport).toBe(true);
    expect(p.categories.practice_records.excluded).toBe(1);
    expect(p.categories.mock_tests.excluded).toBe(1);
    expect(p.issues.filter((i) => i.reason === 'excluded-by-you').length).toBeGreaterThan(0);
    expect(p.ready.some((e) => e.row.chapter_id === D2.id)).toBe(false);
  });
  it('refuses two local chapters landing on one destination chapter (a silent merge)', () => {
    const p = plan({ mapping: { chapters: { [c1]: D1.id, [c2]: D1.id }, subjects: FULL.subjects } });
    expect(p.categories.chapter_progress.attention).toBe(1);
    expect(p.issues.some((i) => i.reason === 'duplicate-id')).toBe(true);
    expect(p.canImport).toBe(false);
  });
});

describe('records and links', () => {
  it('drops a focus record\'s link to a planned session that is not part of the import, but keeps the record', () => {
    const p = plan({ excluded: { chapters: [], subjects: [] }, mapping: { chapters: { [c1]: D1.id, [c2]: D2.id }, subjects: FULL.subjects }, local: { ...local, sessions: local.sessions.filter((s) => s.id !== 's-own-1') } });
    expect(p.droppedLinks).toBe(1);
    expect(p.ready.find((e) => e.key === 'plan-s-own-1')?.row.planner_client_id).toBeNull();
  });
  it('keeps the link when the session is imported too', () => {
    expect(plan().ready.find((e) => e.key === 'plan-s-own-1')?.row.planner_client_id).toBe('s-own-1');
  });
  it('sets aside a record the database would refuse, as needing attention', () => {
    const bad = { ...local, focusLog: local.focusLog.map((f) => (f.id === 'focus-own-1' ? { ...f, minutes: 0 } : f)) };
    const p = plan({ local: bad });
    expect(p.categories.study_sessions.attention).toBe(1);
    expect(p.canImport).toBe(false);
  });
});

describe('what the account already has', () => {
  const server = (): ServerEntity[] => [...snapshotToEntities({ ...local, chapters: [], sessions: [], revisions: [], mockExams: [], practiceLog: [], focusLog: [] }).values()].filter((e) => !isSingle(e.table)).map((e) => ({ ...e, serverId: 's', version: 'v' }));
  it('recognises the same record as already present, and writes nothing for it', () => {
    const first = plan();
    const existing = first.ready.map((e) => ({ ...e, serverId: 's', version: 'v' }));
    const again = plan({ existing });
    expect(again.ready).toEqual([]);
    expect(again.nothingToDo).toBe(true);
    expect(Object.values(again.categories).reduce((n, c) => n + c.present, 0)).toBe(first.ready.length);
    void server;
  });
  it('keeps the account\'s version when the same id exists with different content (server wins), and reports it', () => {
    const first = plan();
    const target = first.ready.find((e) => e.key === 'focus-own-1')!;
    const existing = first.ready.map((e) => ({ ...e, row: e === target ? { ...e.row, minutes: 999 } : e.row, serverId: 's', version: 'v' }));
    const again = plan({ existing });
    expect(again.categories.study_sessions.differs).toBe(1);
    expect(again.ready.find((e) => e.key === 'focus-own-1')).toBeUndefined();
  });
});

describe('fingerprint', () => {
  it('is the same for the same approved data (in any order) and differs for a different selection', async () => {
    const a = await fingerprint(plan().payload);
    const b = await fingerprint([...plan().payload].reverse());
    const c = await fingerprint(plan({ mapping: { chapters: { [c1]: D1.id }, subjects: {} }, excluded: { chapters: [c2], subjects: [subjectId] } }).payload);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it('entity ids are unique within a plan', () => {
    const ids = plan().ready.map((e) => entityId(e.table, e.key));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
