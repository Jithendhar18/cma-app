import { beforeEach, describe, expect, it } from 'vitest';
import { accountKeys, clearAccountKeys, LOCAL_KEYS } from '@/lib/account/keys';
import { CSV, ENROLLMENT, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { DELETE_PHRASE, deleteAccount } from './deleteAccount';

const USER = U(100);
let b: FakeBackend;
const input = (over: Partial<Parameters<typeof deleteAccount>[1]> = {}) => ({ email: 'a@example.test', password: 'correct horse battery', phrase: DELETE_PHRASE, ...over });
const seedData = () => {
  b.rows('student_enrollments').push({ id: ENROLLMENT.id, user_id: USER, csv_id: CSV, exam_attempt_id: U(901), status: 'active', exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: null, created_at: 'x', updated_at: 'x' });
  b.rows('study_sessions').push({ id: U(1), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'f1', chapter_id: U(21), local_date: '2026-11-08', minutes: 5, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: 'u' });
};
const intact = () => b.rows('study_sessions').length === 1 && b.rows('student_enrollments').length === 1 && b.rows('profiles').length === 1;

beforeEach(() => {
  b = createFakeBackend();
  seedBackend(b, { userId: USER });
  b.signInAs(USER, 'a@example.test');
  seedData();
});

describe('deleting an account', () => {
  it('needs the exact phrase and a password before anything is sent', async () => {
    expect(await deleteAccount(b.client, input({ phrase: 'delete my account' }))).toMatchObject({ kind: 'failed', reason: 'refused' });
    expect(await deleteAccount(b.client, input({ phrase: '' }))).toMatchObject({ kind: 'failed' });
    expect(await deleteAccount(b.client, input({ password: '' }))).toMatchObject({ kind: 'failed', reason: 'wrong-password' });
    expect(b.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(b.rpcCalls).toEqual([]);
    expect(intact()).toBe(true);
  });

  it('a wrong password is refused by the server and the delete function is never called', async () => {
    const result = await deleteAccount(b.client, input({ password: 'not the password' }));
    expect(result).toMatchObject({ kind: 'failed', reason: 'wrong-password' });
    expect((result as { message: string }).message).toMatch(/Nothing was deleted/);
    expect(b.rpcCalls).toEqual([]);
    expect(intact()).toBe(true);
  });

  it('asks the server to verify the password freshly, then calls only delete_my_account, and reports success only from the server', async () => {
    const result = await deleteAccount(b.client, input());
    expect(result).toEqual({ kind: 'deleted' });
    expect(b.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(b.rpcCalls.map((c) => c.name)).toEqual(['delete_my_account']);
    expect(b.deletedUsers).toEqual([USER]);
    expect(b.rows('study_sessions')).toEqual([]);
    expect(b.rows('student_enrollments')).toEqual([]);
    expect(b.rows('profiles')).toEqual([]);
    expect(b.rows('courses').length).toBeGreaterThan(0); // the shared curriculum is untouched
  });

  it('uses no admin API, no direct table delete and no privileged path', async () => {
    await deleteAccount(b.client, input());
    expect((b.auth as unknown as { admin?: unknown }).admin).toBeUndefined();
    expect(b.calls.filter((c) => c.op === 'delete')).toEqual([]);
    expect(b.rpcCalls.map((c) => c.name)).toEqual(['delete_my_account']);
  });

  it('the server\'s own recent-authentication guard still decides: a stale sign-in is refused and nothing is deleted', async () => {
    b.auth.signInWithPassword.mockImplementation((async () => ({ data: { user: null, session: null }, error: null })) as never); // accepts, but records no fresh password proof
    b.lastPasswordAuthAt = Date.now() - 10 * 60_000;
    const result = await deleteAccount(b.client, input());
    expect(result).toMatchObject({ kind: 'failed', reason: 'recent-auth' });
    expect(b.deletedUsers).toEqual([]);
    expect(intact()).toBe(true);
  });

  it('a network failure while verifying, or while deleting, deletes nothing', async () => {
    b.auth.signInWithPassword.mockImplementationOnce((async () => { throw new TypeError('Failed to fetch'); }) as never);
    expect(await deleteAccount(b.client, input())).toMatchObject({ kind: 'failed', reason: 'network' });
    expect(b.rpcCalls).toEqual([]);
    b.failNext('rpc:delete_my_account', new TypeError('Failed to fetch'), 1, 'rpc');
    const second = await deleteAccount(b.client, input());
    expect(second.kind).toBe('failed');
    expect(b.deletedUsers).toEqual([]);
    expect(intact()).toBe(true);
  });

  it('an expired session and a server refusal are reported plainly, with nothing deleted', async () => {
    b.failNext('rpc:delete_my_account', { code: '28000', message: 'not signed in' }, 1, 'rpc');
    expect(await deleteAccount(b.client, input())).toMatchObject({ kind: 'failed', reason: 'signed-out' });
    b.failNext('rpc:delete_my_account', { code: 'XX000', message: 'internal detail that must not reach the user' }, 1, 'rpc');
    const refused = await deleteAccount(b.client, input());
    expect(refused).toMatchObject({ kind: 'failed', reason: 'refused' });
    expect((refused as { message: string }).message).not.toContain('internal detail');
    expect(intact()).toBe(true);
  });
});

describe('forgetting a deleted account on this device', () => {
  const OTHER = U(101);
  it('removes only that account\'s keys, never a local-mode key and never another account\'s', () => {
    for (const k of LOCAL_KEYS) localStorage.setItem(k, `${k}-bytes`);
    const mine = accountKeys(USER);
    for (const v of Object.values(mine)) localStorage.setItem(v, 'x');
    localStorage.setItem(`cma-study-os-ui:${USER}`, 'x');
    localStorage.setItem(`cma-sync:${USER}:lease`, 'x');
    for (const v of Object.values(accountKeys(OTHER))) localStorage.setItem(v, 'theirs');
    localStorage.setItem('unrelated-key', 'keep');
    const removed = clearAccountKeys(USER);
    expect(removed.length).toBeGreaterThanOrEqual(Object.keys(mine).length + 2);
    for (const k of LOCAL_KEYS) expect(localStorage.getItem(k)).toBe(`${k}-bytes`);
    for (const v of Object.values(accountKeys(OTHER))) expect(localStorage.getItem(v)).toBe('theirs');
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
    expect(Object.keys(localStorage).filter((k) => k.includes(USER))).toEqual([]);
  });
  it('refuses a malformed user id instead of widening the match', () => {
    expect(() => clearAccountKeys('*')).toThrow();
    expect(() => clearAccountKeys('')).toThrow();
  });
});
