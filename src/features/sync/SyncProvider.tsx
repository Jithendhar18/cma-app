import { useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { useAccountMode } from '@/features/account/accountContext';
import { buildAccountChapters } from '@/lib/account/accountSnapshot';
import { registerSwitchGuard } from '@/lib/account/switchGuards';
import { currentStoreMode, useStoreMode } from '@/lib/account/storeSwap';
import { accountKeys } from '@/lib/account/keys';
import { CurriculumContext } from '@/lib/curriculum/curriculumContext';
import { SyncEngine } from '@/lib/sync/engine';
import { SupabasePersonal } from '@/lib/sync/supabasePersonal';
import { useStudyStore } from '@/stores/studyStore';
import { IDLE_STATUS, INACTIVE, SyncContext, type SyncValue } from './syncContext';

const FLUSH_DELAY_MS = 400;

/**
 * Runs the sync engine for as long as an account's study data is on screen, and not otherwise. It starts when the stores are bound to the
 * signed-in student's enrolment, and stops when they are not (local mode, sign-out, another enrolment). It never runs in local mode.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const account = useAccountMode();
  const curriculum = useContext(CurriculumContext);
  const storeMode = useStoreMode();
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  const userId = auth.state.status === 'signed-in' ? auth.state.user.id : null;
  const enrollment = account.enrollment;
  const tree = curriculum?.status === 'ready' ? curriculum.tree : null;
  const client = auth.client;
  const bound = userId !== null && enrollment !== null && tree !== null && client !== null && account.mode === 'account' && storeMode.kind === 'account' && storeMode.userId === userId && storeMode.enrollmentId === enrollment.id;
  const enrollmentId = enrollment?.id ?? null;
  const csvId = enrollment?.csvId ?? null;
  const attemptStartDate = enrollment?.attemptStartDate ?? null;

  useEffect(() => {
    if (!bound || !userId || !enrollmentId || !csvId || !tree || !client) return;
    const keys = accountKeys(userId);
    const isBound = () => {
      const m = currentStoreMode();
      return m.kind === 'account' && m.userId === userId && m.enrollmentId === enrollmentId;
    };
    const engineNow = new SyncEngine({
      scope: { userId, enrollmentId, csvId },
      repo: new SupabasePersonal(client),
      isBound,
      officialExamDate: () => attemptStartDate,
      read: () => { const s = useStudyStore.getState(); return { settings: s.settings, chapters: s.chapters, sessions: s.sessions, revisions: s.revisions, focusLog: s.focusLog, mockExams: s.mockExams, practiceLog: s.practiceLog, meta: s.meta }; },
      base: (keep) => ({ settings: useStudyStore.getState().settings, chapters: buildAccountChapters(tree, new Map(), keep) }),
      apply: (snapshot) => useStudyStore.setState({ settings: snapshot.settings, chapters: snapshot.chapters, sessions: snapshot.sessions, revisions: snapshot.revisions, focusLog: snapshot.focusLog, mockExams: snapshot.mockExams, practiceLog: snapshot.practiceLog }),
      refreshSession: async () => {
        const { data, error } = await client.auth.refreshSession();
        return !error && data.session !== null;
      },
    });

    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleFlush = () => {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void engineNow.flush(), FLUSH_DELAY_MS);
    };
    const unsubscribeStore = useStudyStore.subscribe(() => {
      if (!isBound()) return;
      engineNow.capture();
      scheduleFlush();
    });
    const resume = () => void engineNow.resume();
    const onVisible = () => { if (document.visibilityState === 'visible') resume(); };
    const onStorage = (e: StorageEvent) => { if (e.key === keys.outbox || e.key === keys.conflicts || e.key === keys.deadLetter) engineNow.refreshFromDisk(); };
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);

    const unregister = registerSwitchGuard('sync', async () => {
      const result = await engineNow.flushAll();
      return result.ok ? { ok: true } : { ok: false, reason: 'pending-changes', message: `${result.pending} change${result.pending === 1 ? '' : 's'} could not be saved to your account yet. Check your connection and try again.` };
    });

    let alive = true;
    void engineNow.hydrate().then(() => {
      if (!alive) return;
      engineNow.start();
      void engineNow.flush();
    });
    setEngine(engineNow);

    return () => {
      alive = false;
      clearTimeout(flushTimer);
      unsubscribeStore();
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      unregister();
      engineNow.dispose();
      setEngine(null);
    };
    // The engine is tied to WHO, WHICH enrolment and WHICH curriculum; it must not restart on unrelated re-renders.
  }, [bound, userId, enrollmentId, csvId, tree, client, attemptStartDate]);

  const status = useSyncExternalStore(
    (listener) => (engine ? engine.subscribe(listener) : () => undefined),
    () => (engine ? engine.getStatus() : IDLE_STATUS),
    () => IDLE_STATUS,
  );

  const value = useMemo<SyncValue>(() => {
    if (!engine) return INACTIVE;
    return {
      active: true, status,
      retry: () => void engine.resume(),
      flushAll: () => engine.flushAll(),
      conflicts: engine.getConflicts(), deadLetters: engine.getDeadLetters(),
      dismissConflict: (id) => engine.dismissConflict(id),
      retryDeadLetter: (id) => engine.retryDeadLetter(id),
      discardDeadLetter: (id) => engine.discardDeadLetter(id),
      exportDiagnostics: () => engine.exportDiagnostics(),
      diagnostics: () => engine.getDiagnostics(),
      unpause: () => engine.unpause(),
    };
    // `status` changes whenever conflicts or set-aside changes do, so the lists are re-read with it.
  }, [engine, status]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
