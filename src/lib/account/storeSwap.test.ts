import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENROLLMENT, FIXTURE_TREE, PROFILE, U, USER_SETTINGS } from '@/test/accountFixtures';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { buildAccountSnapshot } from './accountSnapshot';
import { accountKeys, LOCAL_KEYS } from './keys';
import { currentStoreMode, enterAccountStores, leaveAccountStores, resetStoreSwapForTests } from './storeSwap';

const USER_A = U(100);
const USER_B = U(101);
const snapshotFor = (userId: string, name: string) => buildAccountSnapshot({ profile: PROFILE(userId, name), settings: USER_SETTINGS, enrollment: ENROLLMENT, curriculum: FIXTURE_TREE });
const rawLocal = () => Object.fromEntries(LOCAL_KEYS.map((k) => [k, localStorage.getItem(k)]));

/** Gives the local stores real, recognisable data, persisted the way the app persists it. */
function seedLocal() {
  useStudyStore.getState().updateSettings({ name: 'Local Tester', dailyTargetHours: 7 });
  useUiStore.setState({ sidebarCollapsed: true });
  useTimerStore.getState().setNotes('local timer note');
}

beforeEach(() => {
  resetStoreSwapForTests();
});
afterEach(() => {
  leaveAccountStores();
  resetStoreSwapForTests();
});

describe('entering account mode', () => {
  it('shows the account snapshot, with no demo data and the curriculum chapters', () => {
    seedLocal();
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    const s = useStudyStore.getState();
    expect(s.settings.name).toBe('Asha');
    expect(s.chapters.map((c) => c.id)).toEqual([U(21), U(22), U(23), U(24)]); // the retired chapter is not offered
    expect(s.sessions).toEqual([]);
    expect(s.focusLog).toEqual([]);
    expect(s.meta.seedAnchor).toBeNull();
    expect(s.chapters.every((c) => c.demo === undefined)).toBe(true);
    expect(currentStoreMode()).toEqual({ kind: 'account', userId: USER_A, enrollmentId: ENROLLMENT.id });
  });

  it('writes the account state only to account keys', () => {
    seedLocal();
    const before = rawLocal();
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    useStudyStore.getState().addMockExam({ date: '2026-11-01', subjectId: U(11), name: 'Account mock', score: 50, maxScore: 100 });
    useTimerStore.getState().setNotes('account note');
    useUiStore.setState({ sidebarCollapsed: false });
    expect(rawLocal()).toEqual(before); // byte for byte
    const keys = accountKeys(USER_A);
    expect(localStorage.getItem(keys.study)).toContain('Account mock');
    expect(localStorage.getItem(keys.timer)).toContain('account note');
    expect(localStorage.getItem(`cma-study-os-ui:${USER_A}`)).toContain('false');
  });

  it('makes no write at all to a local key while in account mode (checked on every setItem)', () => {
    seedLocal();
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      writes.push(key);
      return original.call(this, key, value);
    });
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    useStudyStore.getState().updateChapter(U(21), { status: 'learning' });
    useStudyStore.getState().addSession({ date: '2026-11-02', subjectId: U(11), chapterId: U(21), startTime: '09:00', durationMinutes: 30, status: 'upcoming', priority: 'medium', notes: '' });
    leaveAccountStores();
    spy.mockRestore();
    expect(writes.filter((k) => (LOCAL_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('keeps the previous account\'s data away from the next account', () => {
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    useStudyStore.getState().addMockExam({ date: '2026-11-01', subjectId: U(11), name: 'A only', score: 1, maxScore: 10 });
    const aKey = localStorage.getItem(accountKeys(USER_A).study);
    leaveAccountStores();
    enterAccountStores({ userId: USER_B, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_B, 'Bharat') });
    expect(useStudyStore.getState().settings.name).toBe('Bharat');
    expect(useStudyStore.getState().mockExams).toEqual([]);
    expect(JSON.stringify(useStudyStore.getState())).not.toContain('A only');
    expect(localStorage.getItem(accountKeys(USER_B).study)).not.toContain('A only');
    expect(localStorage.getItem(accountKeys(USER_A).study)).toBe(aKey); // B never touched A's mirror
  });

  it('can switch straight from one account to another without a local-mode step in between', () => {
    seedLocal();
    const before = rawLocal();
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    enterAccountStores({ userId: USER_B, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_B, 'Bharat') });
    expect(useStudyStore.getState().settings.name).toBe('Bharat');
    leaveAccountStores();
    expect(useStudyStore.getState().settings.name).toBe('Local Tester');
    expect(rawLocal()).toEqual(before);
  });
});

describe('returning to local mode', () => {
  it('restores the original local data and leaves every local key byte-for-byte unchanged', () => {
    seedLocal();
    const before = rawLocal();
    const localState = JSON.stringify({ s: useStudyStore.getState().settings, c: useStudyStore.getState().chapters.length });
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    useStudyStore.getState().updateSettings({ name: 'Changed in account mode' });
    leaveAccountStores();
    expect(JSON.stringify({ s: useStudyStore.getState().settings, c: useStudyStore.getState().chapters.length })).toBe(localState);
    expect(useStudyStore.getState().settings.name).toBe('Local Tester');
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(useTimerStore.getState().notes).toBe('local timer note');
    expect(rawLocal()).toEqual(before);
    expect(currentStoreMode()).toEqual({ kind: 'local' });
  });

  it('does not overwrite a corrupt local entry with account data', () => {
    seedLocal();
    localStorage.setItem('cma-study-os', '{ this is not valid json');
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    leaveAccountStores();
    expect(localStorage.getItem('cma-study-os')).toBe('{ this is not valid json');
    expect(JSON.stringify(useStudyStore.getState().settings)).not.toContain('Asha');
  });

  it('does not create a local entry that did not exist', () => {
    localStorage.removeItem('cma-study-os');
    localStorage.removeItem('cma-study-os-timer');
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    useStudyStore.getState().updateSettings({ name: 'x' });
    leaveAccountStores();
    expect(localStorage.getItem('cma-study-os')).toBeNull();
    expect(localStorage.getItem('cma-study-os-timer')).toBeNull();
  });

  it('picks up a change another tab made to the local data while this tab was in account mode', () => {
    seedLocal();
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    const stored = JSON.parse(localStorage.getItem('cma-study-os') ?? '{}') as { state: { settings: { name: string } } };
    stored.state.settings.name = 'Edited in another tab';
    localStorage.setItem('cma-study-os', JSON.stringify(stored));
    leaveAccountStores();
    expect(useStudyStore.getState().settings.name).toBe('Edited in another tab');
  });

  it('is a no-op when not in account mode', () => {
    seedLocal();
    const before = rawLocal();
    leaveAccountStores();
    expect(rawLocal()).toEqual(before);
    expect(useStudyStore.getState().settings.name).toBe('Local Tester');
  });
});

describe('the timer', () => {
  it('starts idle in account mode, and a local timer that was running is still running when the user returns', () => {
    seedLocal();
    useTimerStore.getState().start();
    expect(useTimerStore.getState().status).toBe('running');
    const runStartedAt = useTimerStore.getState().runStartedAt;
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    expect(useTimerStore.getState().status).toBe('idle');
    expect(useTimerStore.getState().chapterId).toBe(U(21)); // aimed at an account chapter, never a sample chapter
    leaveAccountStores();
    expect(useTimerStore.getState().status).toBe('running');
    expect(useTimerStore.getState().runStartedAt).toBe(runStartedAt);
    useTimerStore.getState().reset();
  });
});

describe('account keys', () => {
  it('are namespaced by the user and never collide with a local key', () => {
    const keys = accountKeys(USER_A);
    for (const key of Object.values(keys)) {
      expect(key).toContain(USER_A);
      expect(LOCAL_KEYS as readonly string[]).not.toContain(key);
    }
    expect(keys.study).toBe(`cma-study-os:${USER_A}`);
    expect(keys.outbox).toBe(`cma-sync-outbox:${USER_A}`);
  });
  it('refuse a malformed user id', () => {
    for (const bad of ['', '../x', 'a b', 'a:b', 'x'.repeat(100)]) expect(() => accountKeys(bad)).toThrow();
  });

  it('already reports local mode while the local state goes back into the stores, so listeners can tell it is not account data', () => {
    const modeAtEachChange: string[] = [];
    seedLocal();
    enterAccountStores({ userId: USER_A, enrollmentId: ENROLLMENT.id, snapshot: snapshotFor(USER_A, 'Asha') });
    const off = useStudyStore.subscribe(() => modeAtEachChange.push(currentStoreMode().kind));
    leaveAccountStores();
    off();
    expect(modeAtEachChange.length).toBeGreaterThan(0);
    expect(new Set(modeAtEachChange)).toEqual(new Set(['local']));
  });
});
