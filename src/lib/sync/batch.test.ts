import { beforeEach, describe, expect, it } from 'vitest';
import { buildAccountSnapshot } from '@/lib/account/accountSnapshot';
import { CSV, ENROLLMENT, FIXTURE_TREE, PROFILE, U, USER_SETTINGS } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import type { FocusRecord, StudyDataSnapshot } from '@/types/study';
import { SyncEngine } from './engine';
import { Outbox } from './outbox';
import { BULK_MAX, SupabasePersonal } from './supabasePersonal';
import { entityId, toMap, type Op, type Scope } from './types';

const USER = U(100);
const SCOPE: Scope = { userId: USER, enrollmentId: ENROLLMENT.id, csvId: CSV };
const CH = FIXTURE_TREE.chapters[0].id;
let b: FakeBackend;
let repo: SupabasePersonal;

const op = (table: Op['table'], key: string, row: Op['row'], over: Partial<Op> = {}): Op => ({ id: entityId(table, key), kind: 'upsert', table, key, row, isNew: true, baseVersion: null, serverId: null, queuedAt: '2026-11-08T00:00:00Z', attempts: 0, notBefore: null, lastError: null, ...over });
const focus = (i: number | string, over: Record<string, string | number | null> = {}) => op('study_sessions', `f-${i}`, { client_id: `f-${i}`, chapter_id: CH, local_date: '2026-11-08', minutes: 5, mode: 'stopwatch', notes: '', planner_client_id: null, ...over });
const practice = (i: number, correct = 1) => op('practice_records', `p-${i}`, { client_id: `p-${i}`, chapter_id: CH, local_date: '2026-11-08', questions: 5, correct });
const many = (n: number, mk: (i: number) => Op = focus) => Array.from({ length: n }, (_, i) => mk(i));
const writes = () => b.calls.filter((c) => ['insert', 'upsert', 'update', 'delete'].includes(c.op));
const reads = (table: string) => b.calls.filter((c) => c.table === table && c.op === 'select');
const count = (t: string) => b.rows(t).length;

beforeEach(() => {
  localStorage.clear();
  b = createFakeBackend();
  b.signInAs(USER, 'a@example.test');
  repo = new SupabasePersonal(b.client);
});

describe('chunking', () => {
  it.each([[1, 1], [2, 1], [199, 1], [BULK_MAX, 1], [BULK_MAX + 1, 2], [2 * BULK_MAX, 2], [2 * BULK_MAX + 1, 3], [450, 3]])('%i new rows go in %i request(s), all applied, in order', async (n, requests) => {
    const ops = many(n);
    const results = await repo.push(SCOPE, ops);
    expect(results.map((r) => r.op.key)).toEqual(ops.map((o) => o.key));
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect(count('study_sessions')).toBe(n);
    expect(writes()).toHaveLength(requests);
    expect(Math.max(...writes().map((c) => c.rows?.length ?? 0))).toBeLessThanOrEqual(BULK_MAX);
    for (const r of results) if (r.status === 'applied') { expect(r.serverId).toBeTruthy(); expect(r.version).toBeTruthy(); }
  });

  it('stamps every row with the owner, enrolment and syllabus from the scope (never from the operation)', async () => {
    await repo.push(SCOPE, many(5));
    expect(b.rows('study_sessions').every((r) => r.user_id === USER && r.enrollment_id === ENROLLMENT.id && r.csv_id === CSV)).toBe(true);
  });

  it('sends a mixed backlog table by table: parents first, one request per run of new rows', async () => {
    const planner = ['a', 'b', 'c'].map((k) => op('planner_sessions', `s-${k}`, { client_id: `s-${k}`, chapter_id: CH, planned_date: '2026-11-09', start_time: '09:30', duration_minutes: 60, status: 'upcoming', priority: 'medium', notes: '' }));
    const children = [0, 1, 2].map((i) => focus(i, { planner_client_id: `s-${['a', 'b', 'c'][i]}` }));
    const results = await repo.push(SCOPE, [...planner, ...children, ...many(10, practice)]);
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect(writes().map((c) => c.table)).toEqual(['planner_sessions', 'study_sessions', 'practice_records']);
    const sessions = b.rows('planner_sessions');
    for (const f of b.rows('study_sessions')) expect(sessions.some((p) => p.id === f.planner_session_id)).toBe(true);
  });

  it('keeps edits, deletes and account records as their own conditional requests, and keeps the order of results', async () => {
    const first = await repo.push(SCOPE, [focus('x1'), focus('x2')]);
    const [s1, s2] = first.map((r) => (r.status === 'applied' ? r : null));
    b.calls.length = 0;
    const edit = op('study_sessions', 'f-x1', { client_id: 'f-x1', chapter_id: CH, local_date: '2026-11-08', minutes: 9, mode: 'stopwatch', notes: '', planner_client_id: null }, { isNew: false, serverId: s1!.serverId, baseVersion: s1!.version });
    const del = op('study_sessions', 'f-x2', undefined, { kind: 'delete', isNew: false, serverId: s2!.serverId, baseVersion: s2!.version });
    const ops = [focus(1), focus(2), edit, focus(3), focus(4), del];
    const results = await repo.push(SCOPE, ops);
    expect(results.map((r) => r.op.key)).toEqual(ops.map((o) => o.key));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill('applied'));
    expect(writes().map((c) => c.op)).toEqual(['upsert', 'update', 'upsert', 'delete']); // 2 new, the edit, 2 new, the delete
    expect(b.rows('study_sessions').find((r) => r.client_id === 'f-x1')?.minutes).toBe(9);
    expect(b.rows('study_sessions').some((r) => r.client_id === 'f-x2')).toBe(false);
  });
});

describe('duplicates and retries', () => {
  it('sending the same rows again creates nothing: each row is recognised as already there, in one write and one read-back per chunk', async () => {
    await repo.push(SCOPE, many(250));
    b.calls.length = 0;
    const again = await repo.push(SCOPE, many(250));
    expect(again.every((r) => r.status === 'applied')).toBe(true);
    expect(count('study_sessions')).toBe(250);
    expect(writes()).toHaveLength(2); // two chunks, nothing inserted
    expect(reads('study_sessions').length).toBeLessThanOrEqual(2 * Math.ceil(BULK_MAX / 40)); // read back in small groups
    for (const r of again) if (r.status === 'applied') expect(r.serverId).toBeTruthy();
  });

  it('a row that is already there with DIFFERENT content is a conflict carrying the server\'s copy; the rest still apply', async () => {
    b.tables.study_sessions = [{ id: U(5), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'f-2', chapter_id: CH, local_date: '2026-11-08', minutes: 99, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: '2026-11-07T00:00:00.000Z' }];
    const results = await repo.push(SCOPE, many(5));
    const conflict = results.find((r) => r.op.key === 'f-2');
    expect(conflict).toMatchObject({ status: 'conflict', server: { row: { minutes: 99 } } });
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(4);
    expect(b.rows('study_sessions').find((r) => r.client_id === 'f-2')?.minutes).toBe(99); // server wins
    expect(count('study_sessions')).toBe(5);
  });

  it('a transient failure writes nothing (the statement is atomic), reports every row as retry, and a later retry duplicates nothing', async () => {
    b.failNext('study_sessions', { code: '503', status: 503, message: 'busy' }, 1, 'upsert');
    const failed = await repo.push(SCOPE, many(120));
    expect(failed.every((r) => r.status === 'retry' && r.reason === 'transient')).toBe(true);
    expect(count('study_sessions')).toBe(0);
    expect(writes()).toHaveLength(1);
    const retried = await repo.push(SCOPE, many(120));
    expect(retried.every((r) => r.status === 'applied')).toBe(true);
    expect(count('study_sessions')).toBe(120);
  });

  it('offline stops after the first request and leaves the rest untouched (no attempt is wasted)', async () => {
    b.offline = true;
    const results = await repo.push(SCOPE, many(450));
    expect(results.every((r) => r.status === 'retry' && r.reason === 'offline')).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(count('study_sessions')).toBe(0);
  });

  it('an expired session answers "auth" for the whole run after one request', async () => {
    b.failNext('study_sessions', { status: 401, message: 'JWT expired' }, 1, 'upsert');
    const results = await repo.push(SCOPE, many(450));
    expect(results.every((r) => r.status === 'auth')).toBe(true);
    expect(writes()).toHaveLength(1);
  });
});

describe('an invalid operation never costs the others', () => {
  it('finds the one refused row among 200 without losing the 199 good ones, in far fewer requests than one per row', async () => {
    b.rejectRows('practice_records', (r) => r.client_id === 'p-117', { code: '23514', message: 'check violated' });
    const ops = many(200, (i) => practice(i));
    const results = await repo.push(SCOPE, ops);
    expect(results.map((r) => r.op.key)).toEqual(ops.map((o) => o.key));
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(199);
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.op.key)).toEqual(['p-117']);
    expect(count('practice_records')).toBe(199);
    expect(writes().length).toBeLessThan(40); // about 2 * log2(200), not 200
    expect(new Set(b.rows('practice_records').map((r) => r.client_id)).size).toBe(199);
  });

  it('several refused rows are each found and reported; every good row is saved exactly once', async () => {
    const bad = new Set(['p-3', 'p-77', 'p-150']);
    b.rejectRows('practice_records', (r) => bad.has(String(r.client_id)), { code: '23514', message: 'check violated' });
    const results = await repo.push(SCOPE, many(180, (i) => practice(i)));
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.op.key).sort()).toEqual([...bad].sort());
    expect(count('practice_records')).toBe(177);
  });

  it('a per-account limit reached mid-batch saves the rows that fit and refuses the rest with the plain message', async () => {
    b.rejectRows('study_sessions', (r) => Number(String(r.client_id).slice(2)) >= 150, { code: 'P0429', hint: 'QUOTA_EXCEEDED', message: 'quota exceeded for study_sessions' });
    const results = await repo.push(SCOPE, many(200));
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(150);
    const refused = results.filter((r) => r.status === 'rejected');
    expect(refused).toHaveLength(50);
    expect(refused.every((r) => r.status === 'rejected' && /limit/.test(r.detail))).toBe(true);
    expect(count('study_sessions')).toBe(150);
  });

  it('a permission refusal (another user\'s enrolment) is reported for the whole group without splitting it', async () => {
    b.signInAs(U(101), 'b@example.test');
    const results = await repo.push(SCOPE, many(200)); // scope names user A while signed in as B
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(writes()).toHaveLength(1); // not 399
    expect(count('study_sessions')).toBe(0);
  });

  it('a clash with a DIFFERENT record (another unique rule) is found at the single-row level and reported as a conflict with no server copy', async () => {
    b.rejectRows('revisions', (r) => r.client_id === 'r-3', { code: '23505', message: 'duplicate key value violates unique constraint "revisions_one_live_number"' });
    const rev = (i: number) => op('revisions', `r-${i}`, { client_id: `r-${i}`, chapter_id: CH, revision_number: (i % 3) + 1, due_date: '2026-11-20', completed_on: null, cancelled_on: null, priority: 'medium' });
    const results = await repo.push(SCOPE, many(6, rev));
    expect(results.find((r) => r.op.key === 'r-3')).toMatchObject({ status: 'conflict', server: null });
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(5);
  });

  it('a focus record whose planned session is not on the server waits for it; the others in the group go', async () => {
    const results = await repo.push(SCOPE, [focus(1), focus(2, { planner_client_id: 's-missing' }), focus(3)]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'retry', 'applied']);
    expect(count('study_sessions')).toBe(2);
  });
});

describe('through the engine', () => {
  const empty = buildAccountSnapshot({ profile: PROFILE(USER), settings: USER_SETTINGS, enrollment: ENROLLMENT, curriculum: FIXTURE_TREE });
  const rec = (i: number): FocusRecord => ({ id: `focus-${i}`, date: '2026-11-08', subjectId: empty.chapters[0].subjectId, chapterId: empty.chapters[0].id, minutes: 5, mode: 'pomodoro', notes: '', sessionId: null });

  function engine(over: { storage?: Storage; repo?: SupabasePersonal } = {}, clock = { t: Date.parse('2026-11-08T10:00:00.000Z') }) {
    let snap: StudyDataSnapshot = empty;
    const e = new SyncEngine({
      scope: SCOPE, repo: over.repo ?? new SupabasePersonal(b.client), storage: over.storage, read: () => snap, base: () => ({ settings: empty.settings, chapters: empty.chapters }),
      apply: (s) => { snap = s; }, now: () => new Date(clock.t).toISOString(), random: () => 0.5, setTimer: () => 0, clearTimer: () => undefined,
    });
    return { e, clock, get snap() { return snap; }, add: (n: number) => { snap = { ...snap, focusLog: [...snap.focusLog, ...Array.from({ length: n }, (_, i) => rec(i))] }; e.capture(); } };
  }

  it('sends a 450-record backlog in three requests (not 450), empties the queue, and reports it in the diagnostics', async () => {
    const h = engine();
    await h.e.hydrate();
    const before = writes().length;
    h.add(450);
    await h.e.flush();
    expect(count('study_sessions')).toBe(450);
    expect(writes().length - before).toBe(3); // three bulk requests, not 450
    const d = h.e.getDiagnostics();
    expect(d).toMatchObject({ queued: 0, applied: 450, rejected: 0, retried: 0 });
    expect(d.batches).toBeGreaterThanOrEqual(3);
    expect(d.lastBatch?.ops).toBeLessThanOrEqual(BULK_MAX);
    expect(d.requests).toBeGreaterThan(0);
  });

  it('diagnostics hold only counts and times: no content, names, ids or tokens', async () => {
    const h = engine();
    await h.e.hydrate();
    h.add(3);
    await h.e.flush();
    const text = JSON.stringify(h.e.getDiagnostics());
    expect(text).not.toContain('focus-');
    expect(text).not.toContain(USER);
    expect(text).not.toContain(CH);
    for (const v of Object.values(h.e.getDiagnostics())) expect(['number', 'object', 'string']).toContain(typeof v);
  });

  it('one refused record among many is set aside (recoverable) and every other record is saved', async () => {
    const h = engine();
    await h.e.hydrate();
    b.rejectRows('study_sessions', (r) => r.client_id === 'focus-42', { code: '23514', message: 'check violated' });
    h.add(100);
    await h.e.flush();
    expect(count('study_sessions')).toBe(99);
    expect(h.e.getStatus()).toMatchObject({ pending: 0, deadLettered: 1 });
    expect(h.e.getDeadLetters()[0].op.key).toBe('focus-42');
  });

  it('a transient failure keeps the whole group queued with a growing delay, and the retry sends it once', async () => {
    const h = engine();
    await h.e.hydrate();
    h.add(60);
    b.failNext('study_sessions', { code: '503', status: 503, message: 'busy' }, 1, 'upsert');
    await h.e.flush();
    expect(count('study_sessions')).toBe(0);
    const queued = h.e.outbox.all().filter((o) => o.table === 'study_sessions');
    expect(queued).toHaveLength(60);
    expect(queued.every((o) => o.attempts === 1 && o.notBefore !== null)).toBe(true);
    h.clock.t += 60_000;
    await h.e.flush();
    expect(count('study_sessions')).toBe(60);
    expect(h.e.getStatus().pending).toBe(0);
  });

  it('a change another tab queues while a batch is in flight is kept (not overwritten by the batch\'s clean-up) and is sent', async () => {
    const storage = localStorage;
    const h = engine({ storage });
    await h.e.hydrate();
    h.add(30);
    const other = new Outbox(`cma-sync-outbox:${USER}`, storage); // "another tab"
    const slow = new SupabasePersonal(b.client);
    const realPush = slow.push.bind(slow);
    slow.push = async (scope, ops) => {
      const out = await realPush(scope, ops);
      // while the request was in flight, the other tab queued a brand-new record
      other.enqueueDiff(toMap([]), toMap([{ table: 'practice_records', key: 'tab2-pr', row: { client_id: 'tab2-pr', chapter_id: CH, local_date: '2026-11-08', questions: 5, correct: 3 } }]), new Map(), '2026-11-08T10:00:00.000Z');
      return out;
    };
    const h2 = engine({ storage, repo: slow });
    await h2.e.hydrate();
    await h2.e.flush();
    // the other tab's change was neither lost nor overwritten by this tab's clean-up of what it confirmed: it was picked up and sent
    expect(count('study_sessions')).toBe(30);
    expect(count('practice_records')).toBe(1);
    expect(b.rows('practice_records')[0].client_id).toBe('tab2-pr');
    expect(h2.e.outbox.size).toBe(0);
    expect(new Outbox(`cma-sync-outbox:${USER}`, storage).size).toBe(0);
  });

  it('two tabs sharing one queue send the backlog once between them', async () => {
    const a = engine({ storage: localStorage });
    await a.e.hydrate();
    a.add(250);
    const c = engine({ storage: localStorage });
    await c.e.hydrate();
    await Promise.all([a.e.flush(), c.e.flush()]);
    await Promise.all([a.e.flush(), c.e.flush()]);
    expect(count('study_sessions')).toBe(250);
    expect(new Set(b.rows('study_sessions').map((r) => r.client_id)).size).toBe(250);
  });
});

describe('lighter pulls', () => {
  const row = (i: number, over: Record<string, unknown> = {}) => ({ id: U(60000 + i), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: `f-${i}`, chapter_id: CH, local_date: '2026-11-08', minutes: 5, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: `2026-11-08T00:00:00.${String(i).padStart(6, '0')}Z`, ...over });
  const known = (rows: Array<Record<string, unknown>>) => new Map(rows.map((r) => [entityId('study_sessions', String(r.client_id)), String(r.updated_at)]));

  it('reads only ids and versions of rows it already has, and nothing in full when nothing changed', async () => {
    b.tables.study_sessions = Array.from({ length: 300 }, (_, i) => row(i));
    const { rows } = await repo.pullChanges(SCOPE, '2026-11-08T00:00:00.000000Z', known(b.tables.study_sessions));
    expect(rows.filter((r) => r.table === 'study_sessions')).toEqual([]);
    const full = reads('study_sessions').filter((c) => c.cols === '*');
    expect(full).toEqual([]);
    expect(reads('study_sessions').every((c) => /^id, client_id, updated_at$/.test(c.cols ?? ''))).toBe(true);
  });

  it('still returns a row that is new or at a different version, read in full', async () => {
    const all = Array.from({ length: 50 }, (_, i) => row(i));
    b.tables.study_sessions = all;
    const k = known(all);
    b.tables.study_sessions[7] = row(7, { minutes: 99, updated_at: '2026-11-09T00:00:00.000000Z' });
    b.tables.study_sessions.push(row(900));
    const { rows } = await repo.pullChanges(SCOPE, '2026-11-08T00:00:00.000000Z', k);
    expect(rows.filter((r) => r.table === 'study_sessions').map((r) => r.key).sort()).toEqual(['f-7', 'f-900']);
    expect(rows.find((r) => r.key === 'f-7')?.row.minutes).toBe(99);
  });

  it('without a version map it reads everything in full, as before', async () => {
    b.tables.study_sessions = [row(1), row(2)];
    const { rows } = await repo.pullChanges(SCOPE, '2026-11-08T00:00:00.000000Z');
    expect(rows.filter((r) => r.table === 'study_sessions')).toHaveLength(2);
  });

  it('a changed focus record keeps its link to an unchanged planned session', async () => {
    b.tables.planner_sessions = [{ id: U(7), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 's-1', chapter_id: CH, planned_date: '2026-11-09', start_time: '09:30:00', duration_minutes: 60, status: 'upcoming', priority: 'medium', notes: '', created_at: 'c', updated_at: '2026-11-08T00:00:00.000001Z' }];
    b.tables.study_sessions = [row(1, { planner_session_id: U(7) })];
    const k = new Map<string, string>([[entityId('planner_sessions', 's-1'), '2026-11-08T00:00:00.000001Z']]);
    const { rows } = await repo.pullChanges(SCOPE, '2026-11-08T00:00:00.000000Z', k);
    expect(rows.find((r) => r.table === 'study_sessions')?.row.planner_client_id).toBe('s-1');
  });

  it('id reconciliation reads only ids and versions', async () => {
    b.tables.study_sessions = Array.from({ length: 20 }, (_, i) => row(i));
    const ids = await repo.pullIds(SCOPE);
    expect(ids.filter((r) => r.table === 'study_sessions')).toHaveLength(20);
    expect(reads('study_sessions').every((c) => c.cols === 'id, client_id, updated_at')).toBe(true);
  });

  it('counts its own requests', async () => {
    const r0 = repo.requestCount();
    await repo.push(SCOPE, many(10));
    expect(repo.requestCount() - r0).toBe(1);
  });
});

describe('unbinding while a request is in flight', () => {
  const empty = buildAccountSnapshot({ profile: PROFILE(USER), settings: USER_SETTINGS, enrollment: ENROLLMENT, curriculum: FIXTURE_TREE });
  const LOCAL_SAMPLE = { ...empty, chapters: empty.chapters.map((c, i) => ({ ...c, id: `p5-${i + 1}`, status: 'completed' as const })) } as StudyDataSnapshot;

  it('a conflict that arrives after the stores were unbound enqueues nothing from the (now local) store and applies nothing', async () => {
    let snap: StudyDataSnapshot = empty;
    let bound = true;
    const applied: StudyDataSnapshot[] = [];
    b.tables.study_sessions = [{ id: U(5), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'focus-0', chapter_id: CH, local_date: '2026-11-08', minutes: 99, mode: 'pomodoro', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: '2026-11-07T00:00:00.000Z' }];
    const real = new SupabasePersonal(b.client);
    const swapping = Object.assign(Object.create(real), {
      pullAll: real.pullAll.bind(real), pullChanges: real.pullChanges.bind(real), pullIds: real.pullIds.bind(real), requestCount: () => real.requestCount(),
      push: async (scope: Scope, ops: Op[]) => { const out = await real.push(scope, ops); bound = false; snap = LOCAL_SAMPLE; return out; }, // sign-out lands mid-request
    }) as SupabasePersonal;
    const e = new SyncEngine({ scope: SCOPE, repo: swapping, isBound: () => bound, read: () => snap, base: () => ({ settings: empty.settings, chapters: empty.chapters }), apply: (s) => { applied.push(s); snap = s; }, now: () => '2026-11-08T10:00:00.000Z', setTimer: () => 0, clearTimer: () => undefined });
    await e.hydrate();
    snap = { ...snap, focusLog: [...snap.focusLog.filter((f) => f.id !== 'focus-0'), { id: 'focus-0', date: '2026-11-08', subjectId: empty.chapters[0].subjectId, chapterId: CH, minutes: 5, mode: 'pomodoro', notes: '', sessionId: null }] };
    e.capture();
    b.rows('study_sessions')[0].minutes = 77; // another device changed it first
    b.rows('study_sessions')[0].updated_at = b.tick();
    const appliedBefore = applied.length;
    await e.flush();
    expect(e.getConflicts()).toHaveLength(1); // the conflict itself is recorded (it is about the account's own data)
    expect(applied.length).toBe(appliedBefore); // but nothing was applied to the store
    expect(JSON.stringify(e.outbox.all())).not.toContain('p5-');
    expect(e.outbox.size).toBe(0);
    expect(e.getStatus().deadLettered).toBe(0);
    // and nothing was sent on the strength of the local store: no sample progress written, and the account's record was not deleted
    expect(b.rows('chapter_progress')).toEqual([]);
    expect(b.rows('study_sessions').map((r) => [r.client_id, r.minutes])).toEqual([['focus-0', 77]]);
    expect(writes().map((c) => c.op)).toEqual(['update']); // only the one edit that was already being sent
  });

  it('a hydration that returns after the stores were unbound reads, queues and applies nothing', async () => {
    let snap: StudyDataSnapshot = empty;
    let bound = true;
    const applied: StudyDataSnapshot[] = [];
    const real = new SupabasePersonal(b.client);
    const slow = Object.assign(Object.create(real), {
      pullAll: async (scope: Scope) => { const out = await real.pullAll(scope); bound = false; snap = LOCAL_SAMPLE; return out; },
      pullChanges: real.pullChanges.bind(real), pullIds: real.pullIds.bind(real), push: real.push.bind(real), requestCount: () => real.requestCount(),
    }) as SupabasePersonal;
    const e = new SyncEngine({ scope: SCOPE, repo: slow, isBound: () => bound, read: () => snap, base: () => ({ settings: empty.settings, chapters: empty.chapters }), apply: (s) => { applied.push(s); }, now: () => '2026-11-08T10:00:00.000Z', setTimer: () => 0, clearTimer: () => undefined });
    expect(await e.hydrate()).toBe(false);
    expect(applied).toEqual([]);
    expect(e.outbox.size).toBe(0);
  });
});
