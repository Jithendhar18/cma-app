import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedData } from '@/data/seed';
import { CORRUPT_BACKUP_PREFIX, STORAGE_ERROR_EVENT, createSafeStorage } from '@/lib/safeStorage';
import { enableCrossTabSync } from '@/lib/crossTab';
import { validateConsistency } from '@/lib/seedValidation';
import { useStudyStore } from '@/stores/studyStore';
import { applyImportExtras, buildExport } from '@/features/settings/dataTransfer';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { at, freezeClock, resetStores, snapshotOf, TODAY } from '@/test/helpers';

const KEY = 'cma-study-os';
const backups = () => Object.keys(localStorage).filter((k) => k.startsWith(CORRUPT_BACKUP_PREFIX));
const persisted = (state: unknown, version = 3) => localStorage.setItem(KEY, JSON.stringify({ state, version }));

beforeEach(() => {
  freezeClock();
  resetStores();
});

describe('corrupt persisted data', () => {
  it('survives unparseable JSON, falls back to demo data, and keeps the original aside', async () => {
    localStorage.setItem(KEY, '{{{ not json');
    await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().chapters.length).toBeGreaterThan(0);
    expect(backups()).toHaveLength(1);
    expect(localStorage.getItem(backups()[0])).toBe('{{{ not json');
  });

  it('survives data with the wrong shape and backs it up', async () => {
    persisted({ chapters: 'oops', settings: 7 });
    await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().sessions.length).toBeGreaterThan(0);
    expect(backups()).toHaveLength(1);
    expect(localStorage.getItem(backups()[0])).toContain('oops');
  });

  it('survives partially valid data (one bad record) without applying any of it', async () => {
    const bad = createSeedData(TODAY);
    (bad.sessions[0] as unknown as Record<string, unknown>).durationMinutes = 'long';
    bad.settings.name = 'Should not appear';
    persisted(bad);
    await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().settings.name).not.toBe('Should not appear');
    expect(backups()).toHaveLength(1);
  });

  it('does not touch storage when there is nothing stored', async () => {
    await useStudyStore.persist.rehydrate();
    expect(backups()).toHaveLength(0);
  });
});

describe('existing user data is preserved', () => {
  it('loads valid current-format data exactly as saved', async () => {
    const mine = createSeedData(TODAY);
    mine.settings.name = 'Someone Else';
    mine.chapters = mine.chapters.map((c) => (c.id === 'p5-1' ? { ...c, notes: 'my notes', demo: false } : c));
    persisted(mine);
    await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().settings.name).toBe('Someone Else');
    expect(useStudyStore.getState().chapters.find((c) => c.id === 'p5-1')?.notes).toBe('my notes');
    expect(backups()).toHaveLength(0);
  });

  it('upgrades version 2 data in place: user edits survive and demo dates move forward', async () => {
    const old = createSeedData('2026-11-02');
    const legacy = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    delete legacy.meta;
    const strip = (list: unknown) => (list as Array<Record<string, unknown>>).map((r) => { const c = { ...r }; delete c.demo; return c; });
    legacy.sessions = strip(legacy.sessions);
    legacy.focusLog = strip(legacy.focusLog);
    legacy.chapters = strip(legacy.chapters);
    legacy.revisions = strip(legacy.revisions);
    legacy.practiceLog = strip(legacy.practiceLog);
    legacy.mockExams = strip(legacy.mockExams);
    (legacy.sessions as Array<Record<string, unknown>>).push({ id: 's-mine', date: '2026-11-02', subjectId: 'p5', chapterId: 'p5-1', startTime: '07:00', durationMinutes: 30, status: 'completed', priority: 'low', notes: 'keep me' });
    (legacy.settings as Record<string, unknown>).name = 'Legacy User';
    persisted(legacy, 2);

    await useStudyStore.persist.rehydrate();
    const state = useStudyStore.getState();
    expect(state.settings.name).toBe('Legacy User');
    expect(state.sessions.find((s) => s.id === 's-mine')).toMatchObject({ date: '2026-11-02', notes: 'keep me' });
    expect(state.sessions.find((s) => s.id === 's-1')?.date).toBe(TODAY);
    expect(state.meta.seedAnchor).toBe(TODAY);
    expect(backups()).toHaveLength(0);
    expect(validateConsistency(snapshotOf(state), { checkTotals: false })).toEqual([]);
  });

  it('never deletes the stored copy while loading', async () => {
    persisted(createSeedData(TODAY));
    const raw = localStorage.getItem(KEY);
    await useStudyStore.persist.rehydrate();
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('writes changes back and a later load sees them', async () => {
    useStudyStore.getState().updateSettings({ dailyTargetHours: 5 });
    const stored = JSON.parse(localStorage.getItem(KEY) as string);
    expect(stored.version).toBe(3);
    expect(stored.state.settings.dailyTargetHours).toBe(5);
    // A reload reads exactly what was written.
    await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().settings.dailyTargetHours).toBe(5);
  });

  it('repeated loading never duplicates records', async () => {
    useStudyStore.getState().updateSettings({ theme: 'light' });
    const count = useStudyStore.getState().focusLog.length;
    for (let i = 0; i < 3; i += 1) await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().focusLog).toHaveLength(count);
  });
});

describe('safe storage', () => {
  it('reads null for missing keys and never throws for a broken storage object', () => {
    const storage = createSafeStorage(() => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } }) as unknown as Storage);
    expect(storage.getItem('a')).toBeNull();
    expect(() => storage.removeItem('a')).not.toThrow();
    const listener = vi.fn();
    window.addEventListener(STORAGE_ERROR_EVENT, listener);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => storage.setItem('a', 'b')).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(STORAGE_ERROR_EVENT, listener);
  });

  it('works when storage is unavailable', () => {
    const storage = createSafeStorage(() => undefined);
    expect(storage.getItem('a')).toBeNull();
    expect(() => storage.setItem('a', 'b')).not.toThrow();
  });
});

describe('cross-tab sync', () => {
  it('rehydrates the matching store when another tab writes', () => {
    const study = vi.fn();
    const timer = vi.fn();
    const listeners: Array<(e: StorageEvent) => void> = [];
    const fakeWindow = {
      addEventListener: (_t: string, fn: (e: StorageEvent) => void) => listeners.push(fn),
      removeEventListener: (_t: string, fn: (e: StorageEvent) => void) => listeners.splice(listeners.indexOf(fn), 1),
    };
    const stop = enableCrossTabSync([{ key: 'a', rehydrate: study }, { key: 'b', rehydrate: timer }], fakeWindow as unknown as Window);
    listeners[0](new StorageEvent('storage', { key: 'a', newValue: '1' }));
    expect(study).toHaveBeenCalledTimes(1);
    expect(timer).not.toHaveBeenCalled();
    listeners[0](new StorageEvent('storage', { key: 'unknown', newValue: '1' }));
    listeners[0](new StorageEvent('storage', { key: 'a', newValue: null }));
    listeners[0](new StorageEvent('storage', { key: null, newValue: null }));
    expect(study).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners).toHaveLength(0);
  });

  it('picks up changes written by another tab', async () => {
    const other = createSeedData(TODAY);
    other.settings.name = 'Changed In Tab B';
    persisted(other);
    await useStudyStore.persist.rehydrate();
    expect(useStudyStore.getState().settings.name).toBe('Changed In Tab B');
  });
});

describe('export and import of timer and UI state', () => {
  it('exports the timer selection and sidebar state, never an in-flight block', () => {
    freezeClock(at(10, 12));
    useTimerStore.setState({ mode: 'stopwatch', subjectId: 'p6', chapterId: 'p6-2', notes: 'hello', completedFocusCount: 3 });
    useTimerStore.getState().start();
    useUiStore.setState({ sidebarCollapsed: true });
    const out = buildExport();
    expect(out.timer).toEqual({ mode: 'stopwatch', subjectId: 'p6', chapterId: 'p6-2', notes: 'hello', completedFocusCount: 3 });
    expect(out.ui).toEqual({ sidebarCollapsed: true });
    expect(JSON.stringify(out)).not.toContain('runStartedAt');
    useTimerStore.getState().reset();
  });

  it('restores them on import but always leaves the timer idle', () => {
    useTimerStore.setState({ status: 'running', runStartedAt: Date.now(), sessionKey: 'k' });
    applyImportExtras({ timer: { mode: 'stopwatch', subjectId: 'p6', chapterId: 'p6-2', notes: 'n', completedFocusCount: 1 }, ui: { sidebarCollapsed: true } });
    expect(useTimerStore.getState()).toMatchObject({ mode: 'stopwatch', chapterId: 'p6-2', status: 'idle', runStartedAt: null, sessionKey: null });
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it('ignores a timer section that points at a chapter that does not exist', () => {
    applyImportExtras({ timer: { mode: 'stopwatch', subjectId: 'x', chapterId: 'gone', notes: '', completedFocusCount: 0 } });
    expect(useTimerStore.getState().mode).toBe('pomodoro');
    expect(useTimerStore.getState().status).toBe('idle');
  });
});
