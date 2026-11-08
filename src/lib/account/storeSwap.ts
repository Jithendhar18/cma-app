import { useSyncExternalStore } from 'react';
import type { StateStorage } from 'zustand/middleware';
import { createJSONStorage } from 'zustand/middleware';
import { enableCrossTabSync } from '@/lib/crossTab';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import type { StudyDataSnapshot } from '@/types/study';
import { parseAccountSnapshot } from './accountSnapshot';
import { accountKeys, LOCAL_KEYS } from './keys';

/**
 * Account mode and local mode share the same Zustand stores (so every page, selector and action stays exactly as it is) but never share
 * storage. Entering account mode points each store's persistence at per-user keys; leaving it points them back.
 *
 * The rules this file exists to keep:
 *   1. While in account mode nothing writes to `cma-study-os`, `cma-study-os-timer` or `cma-study-os-ui`.
 *   2. Returning to local mode restores the local snapshot WITHOUT writing it: the original bytes on disk are never rewritten, so a
 *      corrupt or newer local entry can never be overwritten with account data.
 *   3. Account data is never loaded under a local key, and local data is never loaded under an account key.
 */

export type StoreMode = { kind: 'local' } | { kind: 'account'; userId: string; enrollmentId: string };

let mode: StoreMode = { kind: 'local' };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const currentStoreMode = (): StoreMode => mode;
export function subscribeStoreMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const useStoreMode = (): StoreMode => useSyncExternalStore(subscribeStoreMode, currentStoreMode, currentStoreMode);

const NULL_STORAGE: StateStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

type StudyOptions = ReturnType<typeof useStudyStore.persist.getOptions>;
type TimerOptions = ReturnType<typeof useTimerStore.persist.getOptions>;
type UiOptions = ReturnType<typeof useUiStore.persist.getOptions>;

interface Backup {
  study: StudyDataSnapshot;
  timer: ReturnType<typeof useTimerStore.getState>;
  ui: { sidebarCollapsed: boolean };
  studyOptions: Pick<StudyOptions, 'name' | 'merge' | 'storage'>;
  timerOptions: Pick<TimerOptions, 'name' | 'storage'>;
  uiOptions: Pick<UiOptions, 'name' | 'storage'>;
}
let backup: Backup | null = null;
let stopCrossTab: (() => void) | null = null;

const pickSnapshot = (s: ReturnType<typeof useStudyStore.getState>): StudyDataSnapshot => ({
  settings: s.settings, chapters: s.chapters, sessions: s.sessions, revisions: s.revisions, focusLog: s.focusLog,
  mockExams: s.mockExams, practiceLog: s.practiceLog, meta: s.meta,
});

/** Persisted account snapshots are validated with the account-aware checks. No demo roll-forward: account data has no demo content. */
function accountMerge(persisted: unknown, current: ReturnType<typeof useStudyStore.getState>) {
  if (persisted === undefined || persisted === null) return current;
  const result = parseAccountSnapshot(persisted);
  return result.ok ? { ...current, ...result.data } : current;
}

const hasKey = (key: string) => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

function idleTimer(chapters: StudyDataSnapshot['chapters']) {
  const pick = chapters.find((c) => c.status !== 'completed' && c.status !== 'exam_ready') ?? chapters[0];
  return {
    mode: 'pomodoro' as const, phase: 'focus' as const, status: 'idle' as const, runStartedAt: null, accumulatedMs: 0, sessionKey: null,
    focusMsByDate: {}, completedFocusCount: 0, subjectId: pick?.subjectId ?? '', chapterId: pick?.id ?? '', notes: '', plannedSessionId: null,
  };
}

/** Switches the stores to a user's account storage and loads `snapshot` into them. Safe to call again for the same account. */
export function enterAccountStores(args: { userId: string; enrollmentId: string; snapshot: StudyDataSnapshot }): void {
  if (mode.kind === 'account') {
    if (mode.userId === args.userId && mode.enrollmentId === args.enrollmentId) return;
    leaveAccountStores();
  }
  const keys = accountKeys(args.userId);
  const study = useStudyStore;
  const timer = useTimerStore;
  const ui = useUiStore;

  const studyOptions = study.persist.getOptions();
  const timerOptions = timer.persist.getOptions();
  const uiOptions = ui.persist.getOptions();
  backup = {
    study: pickSnapshot(study.getState()),
    timer: timer.getState(),
    ui: { sidebarCollapsed: ui.getState().sidebarCollapsed },
    studyOptions: { name: studyOptions.name, merge: studyOptions.merge, storage: studyOptions.storage },
    timerOptions: { name: timerOptions.name, storage: timerOptions.storage },
    uiOptions: { name: uiOptions.name, storage: uiOptions.storage },
  };

  // Point persistence at the account keys FIRST. Only then is any account state set, so it can only ever be written to account keys.
  study.persist.setOptions({ name: keys.study, merge: accountMerge as StudyOptions['merge'] });
  timer.persist.setOptions({ name: keys.timer });
  ui.persist.setOptions({ name: `cma-study-os-ui:${args.userId}` });

  study.setState(args.snapshot);
  if (hasKey(keys.timer)) timer.persist.rehydrate();
  else timer.setState(idleTimer(args.snapshot.chapters));
  // A restored timer may point at a chapter this curriculum does not have: an idle timer is re-aimed, a running one is left alone.
  const t = timer.getState();
  if (t.status === 'idle' && !args.snapshot.chapters.some((c) => c.id === t.chapterId)) timer.setState({ subjectId: idleTimer(args.snapshot.chapters).subjectId, chapterId: idleTimer(args.snapshot.chapters).chapterId });
  if (hasKey(`cma-study-os-ui:${args.userId}`)) ui.persist.rehydrate();

  stopCrossTab = enableCrossTabSync([
    { key: keys.study, rehydrate: () => study.persist.rehydrate() },
    { key: keys.timer, rehydrate: () => timer.persist.rehydrate() },
    { key: `cma-study-os-ui:${args.userId}`, rehydrate: () => ui.persist.rehydrate() },
  ]);
  mode = { kind: 'account', userId: args.userId, enrollmentId: args.enrollmentId };
  notify();
}

/** Returns the stores to local mode, restoring the local snapshot without writing to any local key. */
export function leaveAccountStores(): void {
  if (mode.kind !== 'account' || !backup) {
    mode = { kind: 'local' };
    return;
  }
  const b = backup;
  const study = useStudyStore;
  const timer = useTimerStore;
  const ui = useUiStore;
  stopCrossTab?.();
  stopCrossTab = null;
  // The mode flips FIRST. Putting the local state back changes the stores, and anything listening to them (the sync engine) must already be
  // able to see that this is no longer the account's data, or it would take the local data for the account's own edits.
  mode = { kind: 'local' };

  // 1. Point back at the local keys, but through a sink, so putting the local state back in memory writes nowhere.
  const sink = createJSONStorage(() => NULL_STORAGE);
  study.persist.setOptions({ name: b.studyOptions.name, merge: b.studyOptions.merge, storage: sink });
  timer.persist.setOptions({ name: b.timerOptions.name, storage: sink });
  ui.persist.setOptions({ name: b.uiOptions.name, storage: sink });
  study.setState(b.study);
  timer.setState(b.timer);
  ui.setState(b.ui);
  // 2. Restore the real storage. Nothing has been written. Then pick up anything another tab changed while this tab was in account mode.
  study.persist.setOptions({ storage: b.studyOptions.storage });
  timer.persist.setOptions({ storage: b.timerOptions.storage });
  ui.persist.setOptions({ storage: b.uiOptions.storage });
  if (hasKey(LOCAL_KEYS[0])) study.persist.rehydrate();
  if (hasKey(LOCAL_KEYS[1])) timer.persist.rehydrate();
  if (hasKey(LOCAL_KEYS[2])) ui.persist.rehydrate();

  backup = null;
  mode = { kind: 'local' };
  notify();
}

/** Test helper: forget everything (module state only; the stores themselves are reset by the tests). */
export function resetStoreSwapForTests(): void {
  stopCrossTab?.();
  stopCrossTab = null;
  backup = null;
  mode = { kind: 'local' };
  listeners.clear();
}
