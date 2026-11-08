import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_KEYS } from '@/lib/account/keys';
import { SupabasePersonal } from '@/lib/sync/supabasePersonal';
import { CSV, ENROLLMENT, FIXTURE_TREE, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { localIds, localWithOwnData, persistedLocal } from '@/test/localFixtures';
import { buildImportPlan, fingerprint, NO_EXCLUSIONS, type ImportMapping } from './importPlan';
import { readJob, readRecordedRuns, recordRun, runImport, writeJob, type ImportJob } from './importRun';
import { readLocalStudyData } from './localSource';

const USER = U(100);
const SCOPE = { userId: USER, enrollmentId: ENROLLMENT.id, csvId: CSV };
const local = localWithOwnData();
const { c1, c2, subjectId } = localIds(local);
const [D1, D2] = FIXTURE_TREE.chapters;
const MAPPING: ImportMapping = { chapters: { [c1]: D1.id, [c2]: D2.id }, subjects: { [subjectId]: FIXTURE_TREE.subjects[0].id } };
let b: FakeBackend;
let repo: SupabasePersonal;
const planNow = async () => {
  const { rows } = await repo.pullAll(SCOPE);
  return buildImportPlan({ local, destination: FIXTURE_TREE, mapping: MAPPING, excluded: NO_EXCLUSIONS, existing: rows });
};
const count = (t: string) => b.rows(t).length;

beforeEach(() => {
  localStorage.clear();
  b = createFakeBackend();
  seedBackend(b, { userId: USER });
  b.signInAs(USER, 'a@example.test');
  b.rows('student_enrollments').push({ id: ENROLLMENT.id, user_id: USER, csv_id: CSV, exam_attempt_id: U(901), status: 'active', exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: null, created_at: 'x', updated_at: 'x' });
  repo = new SupabasePersonal(b.client);
});

describe('running an import', () => {
  it('writes every approved record once, as the signed-in user, to the chosen enrolment', async () => {
    const plan = await planNow();
    const result = await runImport({ plan, scope: SCOPE, repo });
    expect(result.state).toBe('complete');
    expect(result.outcomes.study_sessions.imported).toBe(3);
    expect(count('study_sessions')).toBe(3);
    expect(b.rows('study_sessions').every((r) => r.user_id === USER && r.enrollment_id === ENROLLMENT.id && r.csv_id === CSV)).toBe(true);
    expect(b.rows('study_sessions').find((r) => r.client_id === 'plan-s-own-1')?.planner_session_id).toBe(b.rows('planner_sessions')[0].id);
    expect(count('chapter_progress')).toBe(2);
    expect(count('mock_tests')).toBe(1);
  });

  it('is idempotent: running it again, or planning again, writes nothing more and creates no duplicate', async () => {
    await runImport({ plan: await planNow(), scope: SCOPE, repo });
    const before = JSON.stringify(b.tables);
    const second = await planNow();
    expect(second.ready).toEqual([]);
    expect(second.nothingToDo).toBe(true);
    // even forcing the same writes again (a retry whose answer was lost) adds no row
    const forced = await runImport({ plan: await buildImportPlan({ local, destination: FIXTURE_TREE, mapping: MAPPING, excluded: NO_EXCLUSIONS, existing: [] }), scope: SCOPE, repo });
    expect(forced.state).toBe('complete');
    expect(count('study_sessions')).toBe(3);
    expect(count('chapter_progress')).toBe(2);
    expect(count('practice_records')).toBe(1);
    expect(JSON.stringify(b.tables.study_sessions?.map((r) => r.client_id).sort())).toBe(JSON.stringify(JSON.parse(before).study_sessions.map((r: { client_id: string }) => r.client_id).sort()));
  });

  it('never overwrites a record the account already has with different content (server wins) and reports it', async () => {
    await runImport({ plan: await planNow(), scope: SCOPE, repo });
    b.rows('study_sessions').find((r) => r.client_id === 'focus-own-1')!.minutes = 999;
    const forced = await runImport({ plan: buildImportPlan({ local, destination: FIXTURE_TREE, mapping: MAPPING, excluded: NO_EXCLUSIONS, existing: [] }), scope: SCOPE, repo });
    expect(forced.outcomes.study_sessions.keptAccountVersion).toBe(1);
    expect(b.rows('study_sessions').find((r) => r.client_id === 'focus-own-1')?.minutes).toBe(999);
  });

  it('a record that clashes with a DIFFERENT existing record is refused and reported, never counted as "kept"', async () => {
    b.failNext('revisions', { code: '23505', message: 'duplicate key value violates unique constraint "revisions_one_live_number"' }, 1, 'insert');
    const result = await runImport({ plan: await planNow(), scope: SCOPE, repo });
    expect(result.outcomes.revisions).toMatchObject({ imported: 0, keptAccountVersion: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ table: 'revisions', detail: expect.stringContaining('clashes') });
    expect(result.state).toBe('partial');
  });

  it('one refused record does not stop the rest, is reported, and the run is "partial", not "complete"', async () => {
    b.failNext('practice_records', { code: '23514', message: 'check violated' }, 1, 'insert');
    const result = await runImport({ plan: await planNow(), scope: SCOPE, repo });
    expect(result.state).toBe('partial');
    expect(result.failures).toEqual([{ table: 'practice_records', key: 'pr-own-1', detail: expect.stringContaining('refused') }]);
    expect(count('study_sessions')).toBe(3);
    expect(count('mock_tests')).toBe(1);
    // fixing the cause and retrying completes it, without duplicating anything
    const retry = await runImport({ plan: await planNow(), scope: SCOPE, repo });
    expect(retry.state).toBe('complete');
    expect(count('practice_records')).toBe(1);
    expect(count('study_sessions')).toBe(3);
  });

  it('losing the connection pauses it, keeps what was saved, and resuming finishes without duplicates', async () => {
    const plan = await planNow();
    let calls = 0;
    const flaky = { ...repo, pullAll: repo.pullAll.bind(repo), pullChanges: repo.pullChanges.bind(repo), pullIds: repo.pullIds.bind(repo), push: async (s: typeof SCOPE, ops: Parameters<typeof repo.push>[1]) => { if (++calls === 2) b.offline = true; return repo.push(s, ops); } };
    // a chunk size of 50 would send everything at once; use a plan large enough to need two chunks
    const big = { ...plan, ready: [...plan.ready, ...Array.from({ length: 60 }, (_, i) => ({ table: 'study_sessions' as const, key: `bulk-${i}`, row: { client_id: `bulk-${i}`, chapter_id: D1.id, local_date: '2026-11-01', minutes: 5, mode: 'stopwatch', notes: '', planner_client_id: null } }))] };
    const first = await runImport({ plan: big, scope: SCOPE, repo: flaky });
    expect(first.state).toBe('paused');
    expect(first.stoppedBecause).toBe('offline');
    const savedSoFar = count('study_sessions');
    expect(savedSoFar).toBeGreaterThan(0);
    expect(first.outcomes.study_sessions.waiting).toBeGreaterThan(0);
    b.offline = false;
    const { rows } = await repo.pullAll(SCOPE);
    const resumed = await runImport({ plan: { ...big, ready: big.ready.filter((e) => !rows.some((r) => r.table === e.table && r.key === e.key)) }, scope: SCOPE, repo });
    expect(resumed.state).toBe('complete');
    expect(count('study_sessions')).toBe(3 + 60);
    expect(new Set(b.rows('study_sessions').map((r) => r.client_id)).size).toBe(63);
  });

  it('an expired session stops it with "auth" and writes nothing further', async () => {
    b.failNext('planner_sessions', { status: 401, message: 'JWT expired' }, 1, 'insert');
    const result = await runImport({ plan: await planNow(), scope: SCOPE, repo });
    expect(result.state).toBe('paused');
    expect(result.stoppedBecause).toBe('auth');
    expect(count('study_sessions')).toBe(0);
  });

  it('reports progress as it goes, ending at the total', async () => {
    const plan = await planNow();
    const seen: number[] = [];
    await runImport({ plan, scope: SCOPE, repo, onProgress: (done, total) => { seen.push(done); expect(total).toBe(plan.ready.length); } });
    expect(seen.at(-1)).toBe(plan.ready.length);
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
  });
});

describe('local data and local storage', () => {
  it('reads the local snapshot read-only and exactly the one local key', () => {
    localStorage.setItem(LOCAL_KEYS[0], persistedLocal(local));
    localStorage.setItem('some-other-app-key', 'unrelated');
    const spyGet = vi.spyOn(Storage.prototype, 'getItem');
    const spySet = vi.spyOn(Storage.prototype, 'setItem');
    const spyRemove = vi.spyOn(Storage.prototype, 'removeItem');
    const result = readLocalStudyData();
    expect(result.status).toBe('ok');
    expect(spyGet.mock.calls.map((c) => c[0])).toEqual([LOCAL_KEYS[0]]);
    expect(spySet).not.toHaveBeenCalled();
    expect(spyRemove).not.toHaveBeenCalled();
    spyGet.mockRestore(); spySet.mockRestore(); spyRemove.mockRestore();
  });
  it('reports an absent or corrupt local entry without touching it', () => {
    expect(readLocalStudyData().status).toBe('none');
    localStorage.setItem(LOCAL_KEYS[0], '{broken');
    expect(readLocalStudyData().status).toBe('unreadable');
    expect(localStorage.getItem(LOCAL_KEYS[0])).toBe('{broken');
  });
  it('importing changes no local key and writes no account data into one', async () => {
    for (const k of LOCAL_KEYS) localStorage.setItem(k, `${k}-original`);
    localStorage.setItem(LOCAL_KEYS[0], persistedLocal(local));
    const before = LOCAL_KEYS.map((k) => localStorage.getItem(k));
    const writes: string[] = [];
    const orig = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) { writes.push(k); return orig.call(this, k, v); });
    const plan = await planNow();
    await runImport({ plan, scope: SCOPE, repo });
    writeJob(USER, { version: 1, enrollmentId: ENROLLMENT.id, mapping: MAPPING, excluded: NO_EXCLUSIONS, copySettings: false, startedAt: null, updatedAt: 'x', state: 'complete', summary: null });
    spy.mockRestore();
    expect(LOCAL_KEYS.map((k) => localStorage.getItem(k))).toEqual(before);
    for (const k of writes) expect(LOCAL_KEYS as readonly string[]).not.toContain(k);
  });
});

describe('progress and the record of a finished import', () => {
  const job: ImportJob = { version: 1, enrollmentId: ENROLLMENT.id, mapping: MAPPING, excluded: NO_EXCLUSIONS, copySettings: true, startedAt: null, updatedAt: 'x', state: 'partial', summary: { study_sessions: 3 } };
  it('keeps the student\'s choices per user and per enrolment, and never the study content', () => {
    writeJob(USER, job);
    expect(readJob(USER, ENROLLMENT.id)).toMatchObject({ mapping: MAPPING, copySettings: true });
    expect(readJob(USER, U(999))).toBeNull(); // another enrolment never reuses it
    expect(readJob(U(101), ENROLLMENT.id)).toBeNull(); // another user never sees it
    expect(localStorage.getItem(`cma-import-job:${USER}`)).not.toContain('my notes');
    localStorage.setItem(`cma-import-job:${USER}`, '{nope');
    expect(readJob(USER, ENROLLMENT.id)).toBeNull();
  });
  it('records a finished import once, and recognises the same approved data afterwards', async () => {
    const plan = await planNow();
    await runImport({ plan, scope: SCOPE, repo });
    const print = await fingerprint(plan.payload);
    expect(await recordRun(b.client, SCOPE, print, { study_sessions: 3 })).toBe('recorded');
    expect(await recordRun(b.client, SCOPE, print, { study_sessions: 3 })).toBe('already-recorded');
    expect(count('local_import_runs')).toBe(1);
    expect((await readRecordedRuns(b.client, USER)).map((r) => r.sha256)).toEqual([print]);
  });
  it('another user never sees this user\'s import records', async () => {
    const plan = await planNow();
    await recordRun(b.client, SCOPE, await fingerprint(plan.payload), {});
    b.signInAs(U(101), 'b@example.test');
    expect(await readRecordedRuns(b.client, U(101))).toEqual([]);
  });
});
