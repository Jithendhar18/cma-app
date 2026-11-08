import { beforeEach, describe, expect, it } from 'vitest';
import { CSV, ENROLLMENT, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { SupabasePersonal } from './supabasePersonal';
import type { Op, Scope } from './types';

const USER = U(100);
const OTHER = U(101);
const SCOPE: Scope = { userId: USER, enrollmentId: ENROLLMENT.id, csvId: CSV };
const CH = U(21);
let b: FakeBackend;
let repo: SupabasePersonal;

const op = (over: Partial<Op> & Pick<Op, 'table' | 'key'>): Op => ({
  id: `${over.table}:${over.key}`, kind: 'upsert', isNew: true, baseVersion: null, serverId: null, queuedAt: '2026-11-08T00:00:00Z', attempts: 0, notBefore: null, lastError: null, ...over,
});
const focus = (key: string, over: Record<string, string | number | null> = {}): Op =>
  op({ table: 'study_sessions', key, row: { client_id: key, chapter_id: CH, local_date: '2026-11-08', minutes: 25, mode: 'pomodoro', notes: '', planner_client_id: null, ...over } });
const planner = (key: string, over: Record<string, string | number | null> = {}): Op =>
  op({ table: 'planner_sessions', key, row: { client_id: key, chapter_id: CH, planned_date: '2026-11-09', start_time: '09:30', duration_minutes: 60, status: 'upcoming', priority: 'medium', notes: '', ...over } });

beforeEach(() => {
  b = createFakeBackend();
  b.signInAs(USER, 'a@example.test');
  repo = new SupabasePersonal(b.client);
});

describe('writes are scoped and shaped by the client, not trusted from the entity', () => {
  it('stamps the owner, enrolment and syllabus from the scope', async () => {
    const [r] = await repo.push(SCOPE, [focus('f1')]);
    expect(r.status).toBe('applied');
    expect(b.rows('study_sessions')[0]).toMatchObject({ user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'f1', minutes: 25 });
  });
  it('never sends the planner link as a client id, only the server id', async () => {
    await repo.push(SCOPE, [planner('s-1'), focus('plan-s-1', { planner_client_id: 's-1', mode: 'planner' })]);
    const plan = b.rows('planner_sessions')[0];
    expect(b.rows('study_sessions')[0].planner_session_id).toBe(plan.id);
    expect(b.rows('study_sessions')[0]).not.toHaveProperty('planner_client_id');
    expect(plan.start_time).toBe('09:30:00');
  });
  it('makes a focus record wait if its planned session is not on the server', async () => {
    const [r] = await repo.push(SCOPE, [focus('plan-s-9', { planner_client_id: 's-9' })]);
    expect(r).toMatchObject({ status: 'retry', reason: 'transient' });
    expect(b.rows('study_sessions')).toEqual([]);
  });
});

describe('idempotent inserts', () => {
  it('treats a retry whose first answer was lost as done, creating no duplicate', async () => {
    await repo.push(SCOPE, [focus('f1')]);
    const [again] = await repo.push(SCOPE, [focus('f1')]);
    expect(again.status).toBe('applied');
    expect(b.rows('study_sessions')).toHaveLength(1);
  });
  it('reports a conflict when the same id exists with different content (server wins)', async () => {
    await repo.push(SCOPE, [focus('f1', { minutes: 25 })]);
    const [r] = await repo.push(SCOPE, [focus('f1', { minutes: 40 })]);
    expect(r.status).toBe('conflict');
    if (r.status === 'conflict') expect(r.server?.row.minutes).toBe(25);
    expect(b.rows('study_sessions')[0].minutes).toBe(25);
  });
});

describe('conditional updates', () => {
  async function seed() {
    const [r] = await repo.push(SCOPE, [planner('s-1')]);
    if (r.status !== 'applied') throw new Error('seed');
    return r;
  }
  it('applies an edit made on the current version', async () => {
    const seeded = await seed();
    const [r] = await repo.push(SCOPE, [planner('s-1', { notes: 'edited' })].map((o) => ({ ...o, isNew: false, serverId: seeded.serverId, baseVersion: seeded.version })));
    expect(r.status).toBe('applied');
    expect(b.rows('planner_sessions')[0].notes).toBe('edited');
  });
  it('does NOT overwrite a row that changed elsewhere since: it reports the server copy', async () => {
    const seeded = await seed();
    b.rows('planner_sessions')[0].notes = 'edited on another device';
    b.rows('planner_sessions')[0].updated_at = b.tick();
    const [r] = await repo.push(SCOPE, [planner('s-1', { notes: 'mine' })].map((o) => ({ ...o, isNew: false, serverId: seeded.serverId, baseVersion: seeded.version })));
    expect(r.status).toBe('conflict');
    if (r.status === 'conflict') expect(r.server?.row.notes).toBe('edited on another device');
    expect(b.rows('planner_sessions')[0].notes).toBe('edited on another device');
  });
  it('treats an edit identical to the server copy as applied', async () => {
    const seeded = await seed();
    b.rows('planner_sessions')[0].updated_at = b.tick();
    const [r] = await repo.push(SCOPE, [planner('s-1')].map((o) => ({ ...o, isNew: false, serverId: seeded.serverId, baseVersion: seeded.version })));
    expect(r.status).toBe('applied');
  });
  it('reports "deleted elsewhere" when the row is gone', async () => {
    const seeded = await seed();
    b.tables.planner_sessions = [];
    const [r] = await repo.push(SCOPE, [planner('s-1', { notes: 'mine' })].map((o) => ({ ...o, isNew: false, serverId: seeded.serverId, baseVersion: seeded.version })));
    expect(r).toMatchObject({ status: 'conflict', server: null });
  });
});

describe('deletes', () => {
  it('deletes a row still on the version it was based on', async () => {
    const [seeded] = await repo.push(SCOPE, [focus('f1')]);
    if (seeded.status !== 'applied') throw new Error('seed');
    const [r] = await repo.push(SCOPE, [op({ table: 'study_sessions', key: 'f1', kind: 'delete', isNew: false, serverId: seeded.serverId, baseVersion: seeded.version })]);
    expect(r.status).toBe('applied');
    expect(b.rows('study_sessions')).toEqual([]);
  });
  it('does not delete a row changed elsewhere (server wins)', async () => {
    const [seeded] = await repo.push(SCOPE, [focus('f1')]);
    if (seeded.status !== 'applied') throw new Error('seed');
    b.rows('study_sessions')[0].minutes = 99;
    b.rows('study_sessions')[0].updated_at = b.tick();
    const [r] = await repo.push(SCOPE, [op({ table: 'study_sessions', key: 'f1', kind: 'delete', isNew: false, serverId: seeded.serverId, baseVersion: seeded.version })]);
    expect(r.status).toBe('conflict');
    expect(b.rows('study_sessions')).toHaveLength(1);
  });
  it('counts an already-deleted row as done', async () => {
    const [r] = await repo.push(SCOPE, [op({ table: 'study_sessions', key: 'gone', kind: 'delete', isNew: false, serverId: U(5555), baseVersion: 'v' })]);
    expect(r.status).toBe('applied');
  });
  it('refuses to delete a revision (the database never allows it)', async () => {
    const [r] = await repo.push(SCOPE, [op({ table: 'revisions', key: 'r1', kind: 'delete', isNew: false, serverId: U(1), baseVersion: 'v' })]);
    expect(r.status).toBe('rejected');
  });
});

describe('failure handling', () => {
  it('offline: marks the op for retry and stops, leaving the rest untouched', async () => {
    b.offline = true;
    const out = await repo.push(SCOPE, [focus('a'), focus('b'), focus('c')]);
    expect(out.map((r) => r.status)).toEqual(['retry', 'retry', 'retry']);
    expect(out.every((r) => r.status === 'retry' && r.reason === 'offline')).toBe(true);
    expect(b.calls.filter((c) => c.table === 'study_sessions' && (c.op === 'insert' || c.op === 'upsert'))).toHaveLength(1); // one request, then it stops
  });
  it('a server error is transient, a constraint violation is rejected, a quota error is rejected with a plain message', async () => {
    b.failNext('study_sessions', { code: '503', status: 503, message: 'upstream' }, 1, 'insert');
    expect((await repo.push(SCOPE, [focus('t1')]))[0]).toMatchObject({ status: 'retry', reason: 'transient' });
    b.failNext('study_sessions', { code: '23514', message: 'check violated' }, 1, 'insert');
    expect((await repo.push(SCOPE, [focus('t2')]))[0]).toMatchObject({ status: 'rejected' });
    b.failNext('study_sessions', { code: 'P0429', hint: 'QUOTA_EXCEEDED', message: 'quota exceeded for study_sessions' }, 1, 'insert');
    const quota = (await repo.push(SCOPE, [focus('t3')]))[0];
    expect(quota).toMatchObject({ status: 'rejected' });
    if (quota.status === 'rejected') expect(quota.detail).toMatch(/limit/);
  });
  it('an expired session stops the batch with "auth" and sends nothing more', async () => {
    b.failNext('study_sessions', { status: 401, message: 'JWT expired' }, 1);
    const out = await repo.push(SCOPE, [focus('a'), focus('b')]);
    expect(out.map((r) => r.status)).toEqual(['auth', 'auth']);
    expect(b.rows('study_sessions')).toEqual([]);
  });
});

describe('reads', () => {
  const rowFor = (i: number, over: Record<string, unknown> = {}) => ({ id: U(10000 + i), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: `f${i}`, chapter_id: CH, local_date: '2026-11-08', minutes: 5, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: `2026-11-08T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(6, '0')}Z`, ...over });

  it('reads past the 1,000-row API cap by explicit paging', async () => {
    b.tables.study_sessions = Array.from({ length: 2300 }, (_, i) => rowFor(i));
    const { rows, issues } = await repo.pullAll(SCOPE);
    expect(rows).toHaveLength(2300);
    expect(issues).toEqual([]);
    expect(b.calls.filter((c) => c.table === 'study_sessions' && c.op === 'select')).toHaveLength(3);
  });
  it('returns only this enrolment of this user', async () => {
    b.tables.study_sessions = [rowFor(1), rowFor(2, { enrollment_id: U(801) }), rowFor(3, { user_id: OTHER })];
    expect((await repo.pullAll(SCOPE)).rows.map((r) => r.key)).toEqual(['f1']);
  });
  it('skips and reports malformed rows instead of failing the pull', async () => {
    b.tables.study_sessions = [rowFor(1), rowFor(2, { minutes: 'lots' }), rowFor(3, { local_date: null })];
    const { rows, issues } = await repo.pullAll(SCOPE);
    expect(rows.map((r) => r.key)).toEqual(['f1']);
    expect(issues).toHaveLength(2);
  });
  it('maps a planned-session link back to its client id', async () => {
    b.tables.planner_sessions = [{ id: U(7), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 's-1', chapter_id: CH, planned_date: '2026-11-09', start_time: '09:30:00', duration_minutes: 60, status: 'upcoming', priority: 'medium', notes: '', created_at: 'c', updated_at: '2026-11-08T00:00:00.000000Z' }];
    b.tables.study_sessions = [rowFor(1, { planner_session_id: U(7) })];
    const { rows } = await repo.pullAll(SCOPE);
    expect(rows.find((r) => r.table === 'study_sessions')?.row.planner_client_id).toBe('s-1');
    expect(rows.find((r) => r.table === 'planner_sessions')?.row.start_time).toBe('09:30');
  });
  it('pullChanges only returns rows at or after the cursor', async () => {
    b.tables.study_sessions = [rowFor(1, { updated_at: '2026-11-08T01:00:00Z' }), rowFor(2, { updated_at: '2026-11-08T03:00:00Z' })];
    expect((await repo.pullChanges(SCOPE, '2026-11-08T02:00:00Z')).rows.map((r) => r.key)).toEqual(['f2']);
  });
  it('pullIds lists every key with its version, for deletion detection', async () => {
    b.tables.study_sessions = [rowFor(1), rowFor(2)];
    expect((await repo.pullIds(SCOPE)).map((r) => r.key).sort()).toEqual(['f1', 'f2']);
  });
  it('propagates a read failure (so a partial result is never mistaken for the whole)', async () => {
    b.failNext('study_sessions', { code: '08006', message: 'down' });
    await expect(repo.pullAll(SCOPE)).rejects.toBeDefined();
  });
});
