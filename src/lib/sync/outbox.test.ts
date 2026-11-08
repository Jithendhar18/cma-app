import { beforeEach, describe, expect, it } from 'vitest';
import { diffEntities } from './diff';
import { Outbox, type KnownMap } from './outbox';
import { toMap, type Entity } from './types';

const e = (table: Entity['table'], key: string, over: Record<string, string | number | null> = {}): Entity => ({ table, key, row: { client_id: key, chapter_id: 'c1', v: 1, ...over } });
const NOW = '2026-11-08T10:00:00.000Z';
const KEY = 'cma-sync-outbox:test-user';
let box: Outbox;
const known = (...items: Array<[string, string]>): KnownMap => new Map(items.map(([id, version]) => [id, { version, serverId: `srv-${id}` }]));
beforeEach(() => {
  localStorage.clear();
  box = new Outbox(KEY);
});

describe('diffEntities', () => {
  it('finds additions, edits and removals, and nothing when equal', () => {
    const a = toMap([e('study_sessions', 'a'), e('study_sessions', 'b'), e('study_sessions', 'c')]);
    const b = toMap([e('study_sessions', 'a'), e('study_sessions', 'b', { v: 2 }), e('study_sessions', 'd')]);
    const kinds = diffEntities(a, b).map((c) => `${c.kind}:${c.entity.key}`).sort();
    expect(kinds).toEqual(['delete:c', 'upsert:b', 'upsert:d']);
    expect(diffEntities(a, a)).toEqual([]);
  });
});

describe('coalescing', () => {
  it('queues a new row as an insert', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a')]), known(), NOW);
    expect(box.all()).toMatchObject([{ id: 'study_sessions:a', kind: 'upsert', isNew: true, baseVersion: null }]);
  });
  it('folds repeated edits into one op (one op per entity) and keeps it an insert', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a')]), known(), NOW);
    box.enqueueDiff(toMap([e('study_sessions', 'a')]), toMap([e('study_sessions', 'a', { v: 2 })]), known(), NOW);
    box.enqueueDiff(toMap([e('study_sessions', 'a', { v: 2 })]), toMap([e('study_sessions', 'a', { v: 3 })]), known(), NOW);
    expect(box.size).toBe(1);
    expect(box.all()[0]).toMatchObject({ isNew: true, row: { v: 3 } });
  });
  it('queues an edit of a known row as an update on the version it was based on', () => {
    const k = known(['planner_sessions:p', 'V1']);
    box.enqueueDiff(toMap([e('planner_sessions', 'p')]), toMap([e('planner_sessions', 'p', { v: 2 })]), k, NOW);
    expect(box.all()[0]).toMatchObject({ isNew: false, baseVersion: 'V1', serverId: 'srv-planner_sessions:p' });
  });
  it('drops a row that was created and deleted before it ever reached the server', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a')]), known(), NOW);
    box.enqueueDiff(toMap([e('study_sessions', 'a')]), toMap([]), known(), NOW);
    expect(box.size).toBe(0);
  });
  it('turns an edit then a delete of a known row into one delete', () => {
    const k = known(['study_sessions:a', 'V1']);
    box.enqueueDiff(toMap([e('study_sessions', 'a')]), toMap([e('study_sessions', 'a', { v: 2 })]), k, NOW);
    box.enqueueDiff(toMap([e('study_sessions', 'a', { v: 2 })]), toMap([]), k, NOW);
    expect(box.all()).toMatchObject([{ kind: 'delete', baseVersion: 'V1' }]);
  });
  it('deleting a row the server never had queues nothing', () => {
    box.enqueueDiff(toMap([e('study_sessions', 'zzz')]), toMap([]), known(), NOW);
    expect(box.size).toBe(0);
  });
  it('re-creating a row after its queued delete becomes an update of the server row', () => {
    const k = known(['study_sessions:a', 'V1']);
    box.enqueueDiff(toMap([e('study_sessions', 'a')]), toMap([]), k, NOW);
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a', { v: 9 })]), k, NOW);
    expect(box.all()).toMatchObject([{ kind: 'upsert', isNew: false, row: { v: 9 } }]);
  });
});

describe('ordering and batching', () => {
  it('sends parents first and deletes children first', () => {
    const before = toMap([e('study_sessions', 'old'), e('planner_sessions', 'oldp')]);
    const after = toMap([e('study_sessions', 'new'), e('planner_sessions', 'newp'), e('mock_tests', 'm')]);
    box.enqueueDiff(before, after, known(['study_sessions:old', 'V'], ['planner_sessions:oldp', 'V']), NOW);
    expect(box.nextBatch(NOW).map((o) => `${o.kind}:${o.table}`)).toEqual([
      'upsert:planner_sessions', 'upsert:study_sessions', 'upsert:mock_tests', 'delete:study_sessions', 'delete:planner_sessions',
    ]);
  });
  it('caps a batch', () => {
    box.enqueueDiff(toMap([]), toMap(Array.from({ length: 450 }, (_, i) => e('study_sessions', `s${i}`))), known(), NOW);
    expect(box.nextBatch(NOW)).toHaveLength(200);
    expect(box.nextBatch(NOW, 50)).toHaveLength(50);
  });
  it('skips ops that are backing off, and reports when the next becomes due', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a'), e('study_sessions', 'b')]), known(), NOW);
    const a = box.all().find((o) => o.key === 'a')!;
    box.update({ ...a, notBefore: '2026-11-08T10:05:00.000Z', attempts: 1 });
    expect(box.nextBatch(NOW).map((o) => o.key)).toEqual(['b']);
    expect(box.nextDueAt()).toBe('2026-11-08T10:05:00.000Z');
    expect(box.nextBatch('2026-11-08T10:06:00.000Z').map((o) => o.key).sort()).toEqual(['a', 'b']);
  });
});

describe('persistence', () => {
  it('survives a reload and another instance sees the same ops', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a')]), known(), NOW);
    expect(new Outbox(KEY).all()).toEqual(box.all());
  });
  it('removes confirmed ops from disk', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a')]), known(), NOW);
    box.remove(['study_sessions:a']);
    expect(new Outbox(KEY).size).toBe(0);
  });
  it('flags a corrupt queue and keeps valid ops, never throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(new Outbox(KEY).corrupted).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ops: [{ id: 'study_sessions:a', kind: 'upsert', table: 'study_sessions', key: 'a', row: {}, isNew: true, attempts: 0 }, { nonsense: true }] }));
    const loaded = new Outbox(KEY);
    expect(loaded.size).toBe(1);
    expect(loaded.corrupted).toBe(true);
  });
  it('keeps one user\'s queue away from another\'s', () => {
    box.enqueueDiff(toMap([]), toMap([e('study_sessions', 'a')]), known(), NOW);
    expect(new Outbox('cma-sync-outbox:other-user').size).toBe(0);
  });
});
