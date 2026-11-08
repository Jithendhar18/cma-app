import { act, cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAccounts, startApp } from '@/test/appHarness';
import { ATTEMPT, CSV, ENROLLMENT, FIXTURE_TREE, G1, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { resetLinkCacheForTests } from '@/features/auth/pkceCallback';
import { accountKeys } from '@/lib/account/keys';
import { useStudyStore } from '@/stores/studyStore';

// These render the whole app; give slow machines (or a busy CI runner) more than the 1 s default before a lookup gives up.
configure({ asyncUtilTimeout: 6000 });

const client = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/supabase/client')>()), getSupabaseClient: client.getSupabaseClient }));

const USER = U(100);
const CH = FIXTURE_TREE.chapters[0];
let b: FakeBackend;

const enrolled = () => {
  seedBackend(b, { userId: USER });
  b.signInAs(USER, 'asha@example.test');
  b.rows('student_enrollments').push({ id: ENROLLMENT.id, user_id: USER, csv_id: CSV, exam_attempt_id: ATTEMPT, status: 'active', exam_date_override: null, final_revision_date: null, started_at: '2026-11-01T00:00:00Z', archived_at: null, created_at: 'x', updated_at: 'x' });
  b.rows('enrollment_groups').push({ enrollment_id: ENROLLMENT.id, subject_group_id: G1, user_id: USER, csv_id: CSV });
  b.rows('profiles')[0].onboarding_completed_at = '2026-11-01T00:00:00Z';
};
const serverFocus = (i: number, over: Record<string, unknown> = {}) => ({ id: U(30000 + i), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: `srv-${i}`, chapter_id: CH.id, local_date: '2026-11-08', minutes: 45, mode: 'stopwatch', notes: 'from server', planner_session_id: null, started_at: null, created_at: 'c', updated_at: `2026-11-08T0${i}:00:00.000000Z`, ...over });
const record = (id: string, minutes = 30) => ({ id, date: '2026-11-08', subjectId: CH.subjectId, chapterId: CH.id, minutes, mode: 'pomodoro' as const, notes: '', sessionId: null });
const chip = (name: RegExp | string) => screen.findByRole('button', { name: typeof name === 'string' ? `Sync status: ${name}` : name });

beforeEach(() => {
  localStorage.clear();
  b = createFakeBackend();
  client.getSupabaseClient.mockReset();
  client.getSupabaseClient.mockResolvedValue(b.client);
  resetLinkCacheForTests();
  enableAccounts();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('account data is loaded from and saved to the account', () => {
  it('shows the server data after loading, and the chip says Synced', async () => {
    enrolled();
    b.tables.study_sessions = [serverFocus(1)];
    startApp('/');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().focusLog.map((f) => f.id)).toEqual(['srv-1']));
    expect(useStudyStore.getState().chapters.find((c) => c.id === CH.id)?.actualHours).toBe(0.75);
  });

  it('saves a new focus record to the account once, without duplicates, and returns to Synced', async () => {
    enrolled();
    startApp('/');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0));
    act(() => useStudyStore.getState().addFocusRecord(record('focus-new-1', 30)));
    await waitFor(() => expect(b.rows('study_sessions')).toHaveLength(1), { timeout: 3000 });
    expect(b.rows('study_sessions')[0]).toMatchObject({ client_id: 'focus-new-1', minutes: 30, user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV });
    await chip('Synced');
    expect(b.calls.filter((c) => c.table === 'study_sessions' && c.op === 'insert')).toHaveLength(1);
  });

  it('shows "Offline (N pending)", keeps the work, and sends it when the connection returns', async () => {
    enrolled();
    startApp('/');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0));
    b.offline = true;
    act(() => useStudyStore.getState().addFocusRecord(record('focus-off-1')));
    await chip('Offline (2 pending)');
    expect(b.rows('study_sessions')).toEqual([]);
    expect(localStorage.getItem(accountKeys(USER).outbox)).toContain('focus-off-1');
    b.offline = false;
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(b.rows('study_sessions')).toHaveLength(1), { timeout: 3000 });
    await chip('Synced');
  });

  it('shows "Needs attention" and a banner for a change the server refuses, and keeps it reviewable', async () => {
    enrolled();
    const { user } = startApp('/');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0));
    b.failNext('study_sessions', { code: '23514', message: 'check violated' }, 1, 'insert');
    act(() => useStudyStore.getState().addFocusRecord(record('focus-bad-1')));
    await chip('Needs attention');
    expect(await screen.findByText('Some changes could not be saved to your account.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Could not be saved')).toBeTruthy();
  });

  it('writes only to the account\'s own storage keys, never to a local key', async () => {
    enrolled();
    startApp('/');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0));
    const writes: string[] = [];
    const orig = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) { writes.push(k); return orig.call(this, k, v); });
    act(() => useStudyStore.getState().addFocusRecord(record('focus-k-1')));
    await waitFor(() => expect(b.rows('study_sessions')).toHaveLength(1), { timeout: 3000 });
    spy.mockRestore();
    expect(writes.length).toBeGreaterThan(0);
    for (const k of writes) expect(['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui']).not.toContain(k);
    expect(writes.every((k) => k.includes(USER) || k.startsWith('cma-app-mode') || k.includes('lease'))).toBe(true);
  });
});

describe('account settings', () => {
  it('saves the name, a setting and an exam date to the account and writes none of them to a local-only key', async () => {
    enrolled();
    startApp('/');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0));
    const localBefore = ['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui'].map((k) => localStorage.getItem(k));
    const writes: string[] = [];
    const orig = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) { writes.push(`${k}=${v}`); return orig.call(this, k, v); });
    act(() => useStudyStore.getState().updateSettings({ name: 'Renamed Student', dailyTargetHours: 5, examDate: '2027-06-10' }));
    await waitFor(() => expect(b.rows('profiles')[0].display_name).toBe('Renamed Student'), { timeout: 3000 });
    await waitFor(() => expect(b.rows('student_enrollments')[0].exam_date_override).toBe('2027-06-10'), { timeout: 3000 });
    expect(b.rows('user_settings')[0].daily_target_hours).toBe(5);
    spy.mockRestore();
    for (const w of writes) {
      const key = w.split('=')[0];
      expect(['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui']).not.toContain(key);
      if (w.includes('Renamed Student')) expect(key.includes(USER)).toBe(true);
    }
    expect(['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui'].map((k) => localStorage.getItem(k))).toEqual(localBefore);
    await chip('Synced');
  });
});

describe('local mode never syncs', () => {
  it('shows no chip and touches no personal table when the student chose this device only', async () => {
    enrolled();
    localStorage.setItem(accountKeys(USER).mode, 'local');
    startApp('/');
    await screen.findAllByText('Workspace');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /Sync status/ })).toBeNull();
    const personal = ['chapter_progress', 'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests'];
    expect(b.calls.filter((c) => personal.includes(c.table))).toEqual([]);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('cma-sync'))).toEqual([]);
  });
});

describe('guards', () => {
  it('blocks changing the enrolment while changes are unsaved, with a plain explanation', async () => {
    enrolled();
    const { user } = startApp('/settings');
    await chip('Synced');
    await screen.findByText('Syllabus version');
    b.offline = true;
    act(() => useStudyStore.getState().addFocusRecord(record('focus-guard-1')));
    await chip('Offline (2 pending)');
    await user.click(screen.getByRole('button', { name: /Archive enrolment/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Archive enrolment/i }));
    expect(await screen.findByText(/2 changes could not be saved to your account yet/)).toBeTruthy();
    expect(b.rpcCalls.filter((c) => c.name === 'archive_enrollment')).toEqual([]);
  });

  it('lets the enrolment change once everything is saved', async () => {
    enrolled();
    const { user } = startApp('/settings');
    await chip('Synced');
    await screen.findByText('Syllabus version');
    await user.click(screen.getByRole('button', { name: /Archive enrolment/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Archive enrolment/i }));
    await waitFor(() => expect(b.rpcCalls.map((c) => c.name)).toContain('archive_enrollment'));
  });

  it('warns before signing out with unsaved changes; "Sign out anyway" keeps them on this device', async () => {
    enrolled();
    const { user } = startApp('/account');
    await chip('Synced');
    await waitFor(() => expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0));
    b.offline = true;
    act(() => useStudyStore.getState().addFocusRecord(record('focus-out-1')));
    await chip('Offline (2 pending)');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/2 changes have not been saved to your account yet/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    await waitFor(() => expect(localStorage.getItem(accountKeys(USER).outbox)).toContain('focus-out-1'));
    await new Promise((r) => setTimeout(r, 100));
    expect(localStorage.getItem(accountKeys(USER).study)).not.toBeNull();
    // NEGATIVE CONTROL: going back to local mode must never turn the local sample data into account changes
    const outbox = localStorage.getItem(accountKeys(USER).outbox) ?? '';
    expect(outbox).not.toContain('p5-');
    expect(JSON.parse(outbox).ops.map((o: { key: string }) => o.key).sort()).toEqual([CH.id, 'focus-out-1'].sort());
  });

  it('signs out without a prompt when everything is saved, leaving account storage and local keys alone', async () => {
    enrolled();
    const { user } = startApp('/account');
    await chip('Synced');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByText(/not been saved/)).toBeNull();
    await waitFor(() => expect(localStorage.getItem(accountKeys(USER).study)).not.toBeNull());
  });
});
