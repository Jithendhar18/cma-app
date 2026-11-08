import { act, cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAccounts, startApp } from '@/test/appHarness';
import { ATTEMPT, CSV, ENROLLMENT, FIXTURE_TREE, G1, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { localIds, localWithOwnData } from '@/test/localFixtures';
import { resetLinkCacheForTests } from '@/features/auth/pkceCallback';
import { accountKeys, LOCAL_KEYS } from '@/lib/account/keys';
import { useStudyStore } from '@/stores/studyStore';
import { DELETE_PHRASE } from '@/lib/portability/deleteAccount';

configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });

const client = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/supabase/client')>()), getSupabaseClient: client.getSupabaseClient }));

const USER = U(100);
const local = localWithOwnData();
const { c1, c2 } = localIds(local);
const title = (id: string) => local.chapters.find((c) => c.id === id)!.title;
const [D1, D2] = FIXTURE_TREE.chapters;
let b: FakeBackend;

const enrolled = () => {
  seedBackend(b, { userId: USER, displayName: 'Asha' });
  b.signInAs(USER, 'asha@example.test');
  b.rows('student_enrollments').push({ id: ENROLLMENT.id, user_id: USER, csv_id: CSV, exam_attempt_id: ATTEMPT, status: 'active', exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' });
  b.rows('enrollment_groups').push({ enrollment_id: ENROLLMENT.id, subject_group_id: G1, user_id: USER, csv_id: CSV });
  b.rows('profiles')[0].onboarding_completed_at = '2026-11-01T00:00:00.000Z';
};
/** Puts the student's local data where local mode keeps it, written by the local store itself (so the bytes are the app's own). */
const withLocalData = () => {
  act(() => useStudyStore.setState({ ...local }));
  return LOCAL_KEYS.map((k) => localStorage.getItem(k));
};
const localBytes = () => LOCAL_KEYS.map((k) => localStorage.getItem(k));
const chip = (name: string) => screen.findByRole('button', { name: `Sync status: ${name}` });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  act(() => useStudyStore.getState().resetDemoData()); // the in-memory local store is a singleton: start each test from fresh sample data
  b = createFakeBackend();
  client.getSupabaseClient.mockReset();
  client.getSupabaseClient.mockResolvedValue(b.client);
  resetLinkCacheForTests();
  enableAccounts();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('import wizard', () => {
  it('is unavailable, with the reason, when enrolment is not open yet (nothing to import into)', async () => {
    seedBackend(b, { userId: USER, publishedGroups: [] });
    b.signInAs(USER, 'asha@example.test');
    startApp('/account');
    const button = await screen.findByRole('button', { name: 'Start the import' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/enrolment is not open yet/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Start the import/ })).toBeNull();
  });

  it('walks through match, review and confirm; imports once; leaves local data byte-for-byte unchanged', async () => {
    enrolled();
    const before = withLocalData();
    const { user } = startApp('/account');
    await chip('Synced');
    await user.click(await screen.findByRole('link', { name: /Start the import/ }));
    expect(await screen.findByText(/Found \d+ of your own records/)).toBeTruthy();
    expect(screen.getByText(/you match each one yourself/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start' }));

    // nothing is matched for you: every chapter starts unmatched and Review is blocked
    const review = await screen.findByRole('button', { name: 'Review' });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(title(c1)) as HTMLSelectElement).value).toBe('');
    await user.selectOptions(screen.getByLabelText(title(c1)), D1.id);
    await user.selectOptions(screen.getByLabelText(title(c2)), D2.id);
    await user.selectOptions(screen.getByLabelText(/mock tests/), FIXTURE_TREE.subjects[0].id);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Review' }));

    // the preview says what will happen, and the final button needs an explicit confirmation
    expect(await screen.findByText(/The data on this device will not change/)).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: /Focus time/ }).textContent).toContain('3');
    const go = screen.getByRole('button', { name: /^Import \d+ records?$/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(b.rows('study_sessions')).toEqual([]);
    await user.click(screen.getByLabelText(/I understand this saves/));
    await user.click(go);

    expect(await screen.findByText('Import finished.')).toBeTruthy();
    expect(b.rows('study_sessions').map((r) => r.client_id).sort()).toEqual(['focus-own-1', 'focus-own-2', 'plan-s-own-1']);
    expect(b.rows('chapter_progress')).toHaveLength(2);
    expect(b.rows('mock_tests')).toHaveLength(1);
    expect(b.rows('local_import_runs')).toHaveLength(1);
    expect(localBytes()).toEqual(before);
    // the imported data shows up in the account's own screens
    await waitFor(() => expect(useStudyStore.getState().focusLog.map((f) => f.id)).toContain('focus-own-1'), { timeout: 6000 });
    expect(JSON.stringify(b.tables)).not.toContain('"demo"');
  });

  it('lets the student leave a chapter out, says so in the review, and does not import it', async () => {
    enrolled();
    withLocalData();
    const { user } = startApp('/account/import');
    await chip('Synced');
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.selectOptions(await screen.findByLabelText(title(c1)), D1.id);
    await user.click(within(screen.getByLabelText(title(c2)).closest('li')!).getByLabelText('Leave out'));
    await user.click(within(screen.getByLabelText(/mock tests/).closest('li')!).getByLabelText('Leave out'));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(within(await screen.findByRole('table')).getByRole('row', { name: /Practice records/ }).textContent).toMatch(/1$/); // left out
    await user.click(screen.getByLabelText(/I understand this saves/));
    await user.click(screen.getByRole('button', { name: /^Import \d+ records?$/ }));
    expect(await screen.findByText('Import finished.')).toBeTruthy();
    expect(b.rows('practice_records')).toEqual([]);
    expect(b.rows('mock_tests')).toEqual([]);
    expect(b.rows('chapter_progress')).toHaveLength(1);
  });

  it('shows a partial result honestly, keeps what was saved, and a retry completes without duplicates', async () => {
    enrolled();
    withLocalData();
    const { user } = startApp('/account/import');
    await chip('Synced');
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.selectOptions(await screen.findByLabelText(title(c1)), D1.id);
    await user.selectOptions(screen.getByLabelText(title(c2)), D2.id);
    await user.selectOptions(screen.getByLabelText(/mock tests/), FIXTURE_TREE.subjects[0].id);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByLabelText(/I understand this saves/));
    b.failNext('practice_records', { code: '23514', message: 'check violated' }, 1, 'insert');
    await user.click(screen.getByRole('button', { name: /^Import \d+ records?$/ }));
    expect(await screen.findByText('Import finished with problems.')).toBeTruthy();
    expect(screen.queryByText('Import finished.')).toBeNull();
    expect(b.rows('study_sessions')).toHaveLength(3);
    expect(b.rows('local_import_runs')).toEqual([]); // a partial import is not recorded as done
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Import finished.')).toBeTruthy();
    expect(b.rows('practice_records')).toHaveLength(1);
    expect(b.rows('study_sessions')).toHaveLength(3);
  });

  it('cancelling writes nothing and changes nothing', async () => {
    enrolled();
    const before = withLocalData();
    const { user } = startApp('/account/import');
    await chip('Synced');
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(b.calls.filter((c) => c.op !== 'select')).toEqual([]);
    expect(localBytes()).toEqual(before);
  });

  it('says there is nothing to import when the device has only sample data', async () => {
    enrolled();
    startApp('/account/import');
    await chip('Synced');
    expect(await screen.findByText(/only sample data/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('export', () => {
  const stubDownload = () => {
    const saved: Blob[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (blob: Blob) => { saved.push(blob); return 'blob:test'; };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    return saved;
  };
  it('downloads the account data as one file, reports what was in it, and changes nothing', async () => {
    enrolled();
    b.rows('study_sessions').push({ id: U(1), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'f1', chapter_id: D1.id, local_date: '2026-11-08', minutes: 5, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: 'u' });
    const saved = stubDownload();
    const { user } = startApp('/account');
    const button = await screen.findByRole('button', { name: 'Download my data' });
    await chip('Synced');
    const before = JSON.stringify(b.tables);
    await user.click(button);
    expect(await screen.findByText('Your data was downloaded.')).toBeTruthy();
    expect(saved).toHaveLength(1);
    const doc = JSON.parse(await saved[0].text());
    expect(doc).toMatchObject({ format: 'cma-study-os-account-export', schema_version: 1 });
    expect(doc.data.study_sessions).toHaveLength(1);
    const after = JSON.parse(JSON.stringify(b.tables)) as Record<string, unknown>;
    const was = JSON.parse(before) as Record<string, unknown>;
    expect(Object.keys(after).filter((t) => JSON.stringify(after[t]) !== JSON.stringify(was[t] ?? []))).toEqual([]);
  });
  it('says plainly when it could not collect the data, and downloads nothing', async () => {
    enrolled();
    const saved = stubDownload();
    const { user } = startApp('/account');
    const button = await screen.findByRole('button', { name: 'Download my data' });
    b.failNext('student_enrollments', new TypeError('Failed to fetch'));
    await user.click(button);
    expect(await screen.findByText(/nothing was downloaded/i)).toBeTruthy();
    expect(screen.queryByText('Your data was downloaded.')).toBeNull();
    expect(saved).toEqual([]);
  });
});

describe('account deletion', () => {
  const open = async (user: ReturnType<typeof startApp>['user']) => {
    await user.click(await screen.findByRole('button', { name: 'Delete my account…' }));
    return screen.findByRole('dialog');
  };
  it('is never one click: the destructive button needs the phrase and the password, and does not exist before the dialog', async () => {
    enrolled();
    const { user } = startApp('/account');
    expect(screen.queryByRole('button', { name: 'Delete my account permanently' })).toBeNull();
    const dialog = await open(user);
    const go = within(dialog).getByRole('button', { name: 'Delete my account permanently' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(within(dialog).getByText(/cannot be undone/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Download my data first/ })).toBeTruthy();
    await user.type(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`), 'delete my account');
    await user.type(within(dialog).getByLabelText('Your password'), 'correct horse battery');
    expect(go.disabled).toBe(true); // wrong case
    await user.clear(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`));
    await user.type(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`), DELETE_PHRASE);
    expect(go.disabled).toBe(false);
    expect(b.rpcCalls).toEqual([]);
  });

  it('cancelling does nothing', async () => {
    enrolled();
    const { user } = startApp('/account');
    const dialog = await open(user);
    await user.type(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`), DELETE_PHRASE);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(b.rpcCalls).toEqual([]);
    expect(b.deletedUsers).toEqual([]);
    expect(b.rows('profiles')).toHaveLength(1);
  });

  it('a wrong password leaves the account intact, signed in, with a clear message', async () => {
    enrolled();
    const { user } = startApp('/account');
    const dialog = await open(user);
    await user.type(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`), DELETE_PHRASE);
    await user.type(within(dialog).getByLabelText('Your password'), 'wrong password');
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account permanently' }));
    expect(await within(dialog).findByText(/password is not correct\. Nothing was deleted/)).toBeTruthy();
    expect(b.rpcCalls).toEqual([]);
    expect(b.rows('profiles')).toHaveLength(1);
    expect(screen.queryByText('Your account was deleted.')).toBeNull();
    expect(Object.keys(localStorage).some((k) => k.includes(USER))).toBe(true);
  });

  it('a server refusal or network failure shows no success and deletes nothing', async () => {
    enrolled();
    const { user } = startApp('/account');
    const dialog = await open(user);
    await user.type(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`), DELETE_PHRASE);
    await user.type(within(dialog).getByLabelText('Your password'), 'correct horse battery');
    b.failNext('rpc:delete_my_account', new TypeError('Failed to fetch'), 1, 'rpc');
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account permanently' }));
    expect(await within(dialog).findByText(/Could not reach the server\. Nothing was deleted/)).toBeTruthy();
    expect(b.deletedUsers).toEqual([]);
    expect(screen.queryByText('Your account was deleted.')).toBeNull();
    expect(b.rows('student_enrollments')).toHaveLength(1);
  });

  it('on the server\'s confirmation, signs out, forgets only this account\'s keys, and leaves local mode byte-for-byte alone', async () => {
    enrolled();
    const before = withLocalData();
    const { user } = startApp('/account');
    await chip('Synced');
    const dialog = await open(user);
    await user.type(within(dialog).getByLabelText(`Type ${DELETE_PHRASE} to confirm`), DELETE_PHRASE);
    await user.type(within(dialog).getByLabelText('Your password'), 'correct horse battery');
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account permanently' }));
    expect(await screen.findByText('Your account was deleted.')).toBeTruthy();
    expect(b.rpcCalls.map((c) => c.name)).toEqual(['delete_my_account']);
    expect(b.deletedUsers).toEqual([USER]);
    await waitFor(() => expect(Object.keys(localStorage).filter((k) => k.includes(USER))).toEqual([]));
    expect(localBytes()).toEqual(before);
    expect(accountKeys(USER).study in localStorage).toBe(false);
    expect(b.auth.signOut).toHaveBeenCalled();
  });
});
