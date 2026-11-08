import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { demoLibraryAdapter } from '@/data/library';
import { useAccountMode } from '@/features/account/accountContext';
import type { LibraryAdapter } from '@/types/library';
import { BUNDLED_CURRICULUM } from './bundled';
import { curriculumIdentity, readCurriculumCache, writeCurriculumCache } from './cache';
import { CurriculumContext, emptyAccountTree, makeCurriculumValue, type CurriculumValue } from './curriculumContext';
import type { CurriculumTree, DataIssue } from './types';

const LOCAL_VALUE = makeCurriculumValue({ status: 'ready', tree: BUNDLED_CURRICULUM, library: demoLibraryAdapter });

type AccountLoad =
  | { csvId: string; status: 'loading' }
  | { csvId: string; status: 'ready'; tree: CurriculumTree; stale: boolean; issues: DataIssue[] }
  | { csvId: string; status: 'error'; message: string };

/**
 * Local mode: the bundled sample, exactly as before (nothing is requested).
 * Account mode: the active enrolment's syllabus, from the validated cache at once and refreshed in the background.
 *
 * In account mode the sample curriculum is NEVER a fallback. While loading, or after a failure with no cache, the curriculum is empty and
 * the app says so, because attaching a student's progress to unrelated sample chapters would corrupt it.
 */
export function CurriculumProvider({ children }: { children: ReactNode }) {
  const account = useAccountMode();
  const csvId = account.mode === 'account' ? (account.enrollment?.csvId ?? null) : null;
  const identityNames = account.enrollment ? { courseName: account.enrollment.courseName, syllabusName: account.enrollment.syllabusName } : null;
  const repo = account.services?.curriculum ?? null;

  const [load, setLoad] = useState<AccountLoad | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = useRef(0);
  const names = useRef(identityNames);
  names.current = identityNames;

  useEffect(() => {
    if (!csvId || !repo) {
      token.current++;
      setLoad(null);
      return;
    }
    const mine = ++token.current;
    const id = csvId;
    const cached = readCurriculumCache(id);
    // Show what was validated last time immediately, and say it may be out of date until the refresh finishes.
    setLoad(cached ? { csvId: id, status: 'ready', tree: cached.tree, stale: true, issues: [] } : { csvId: id, status: 'loading' });
    repo
      .loadCurriculum(id)
      .then(({ tree, issues }) => {
        if (mine !== token.current) return; // the enrolment changed while this was loading
        if (tree.subjects.length === 0 || tree.chapters.length === 0) throw new Error('The curriculum for this enrolment is incomplete.');
        const full: CurriculumTree = { ...tree, identity: { source: 'account', csvId: id, courseName: names.current?.courseName ?? null, syllabusName: names.current?.syllabusName ?? null } };
        const changed = !cached || cached.identity !== curriculumIdentity(tree);
        if (changed) writeCurriculumCache(id, full); // replaced only after the new payload passed validation
        setLoad({ csvId: id, status: 'ready', tree: changed || !cached ? full : cached.tree, stale: false, issues });
      })
      .catch((e: unknown) => {
        if (mine !== token.current) return;
        const message = e instanceof Error && e.message.includes('incomplete') ? e.message : 'The curriculum could not be loaded. Check your connection and try again.';
        // A cached copy keeps the app usable; only with nothing cached is this an error state.
        setLoad(cached ? { csvId: id, status: 'ready', tree: cached.tree, stale: true, issues: [] } : { csvId: id, status: 'error', message });
      });
  }, [csvId, repo, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<CurriculumValue>(() => {
    if (account.mode !== 'account') return LOCAL_VALUE;
    const library: LibraryAdapter = {
      id: 'account',
      label: 'Official resources',
      isDemo: false,
      load: () => (repo && csvId ? repo.listResources(csvId) : Promise.resolve([])),
    };
    // Only a load for the CURRENT syllabus is ever used; a result for another csv_id is treated as not loaded yet.
    const current = load && load.csvId === csvId ? load : null;
    if (!current || current.status === 'loading') return makeCurriculumValue({ status: 'loading', tree: emptyAccountTree(), retry, library });
    if (current.status === 'error') return makeCurriculumValue({ status: 'error', tree: emptyAccountTree(), error: current.message, retry, library });
    return makeCurriculumValue({ status: 'ready', tree: current.tree, stale: current.stale, issues: current.issues, retry, library });
  }, [account.mode, load, csvId, repo, retry]);

  return <CurriculumContext.Provider value={value}>{children}</CurriculumContext.Provider>;
}
