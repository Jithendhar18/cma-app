import { createContext, useContext } from 'react';
import type { LibraryAdapter } from '@/types/library';
import { BUNDLED_CURRICULUM } from './bundled';
import type { CurriculumChapter, CurriculumGroup, CurriculumIdentity, CurriculumSubject, CurriculumTree, DataIssue } from './types';

export interface CurriculumValue {
  /** `loading` and `error` only occur in account mode. Local mode is always `ready` (the bundled sample). */
  status: 'loading' | 'ready' | 'error';
  tree: CurriculumTree;
  identity: CurriculumIdentity;
  subjects: CurriculumSubject[];
  groups: CurriculumGroup[];
  chapters: CurriculumChapter[];
  subjectById: (id: string) => CurriculumSubject | undefined;
  /** Matches the URL segment: the database slug in account mode, the id ('p5') in local mode. */
  subjectBySlug: (slug: string) => CurriculumSubject | undefined;
  chapterById: (id: string) => CurriculumChapter | undefined;
  groupByName: (name: string) => CurriculumGroup | undefined;
  /** True while a cached copy is shown and a refresh is running or has failed. */
  stale: boolean;
  error: string | null;
  /** Rows the server sent that failed validation and were skipped. */
  issues: DataIssue[];
  retry: () => void;
  library: LibraryAdapter;
}

const EMPTY_IDENTITY: CurriculumIdentity = { source: 'account', csvId: null, courseName: null, syllabusName: null };

export function makeCurriculumValue(parts: {
  status: CurriculumValue['status'];
  tree: CurriculumTree;
  stale?: boolean;
  error?: string | null;
  issues?: DataIssue[];
  retry?: () => void;
  library: LibraryAdapter;
}): CurriculumValue {
  const { tree } = parts;
  const subjects = new Map(tree.subjects.map((s) => [s.id, s]));
  const slugs = new Map(tree.subjects.map((s) => [s.slug, s]));
  const chapters = new Map(tree.chapters.map((c) => [c.id, c]));
  const groups = new Map(tree.groups.map((g) => [g.name, g]));
  return {
    status: parts.status, tree, identity: tree.identity, subjects: tree.subjects, groups: tree.groups, chapters: tree.chapters,
    subjectById: (id) => subjects.get(id),
    // Local routes use the id; accept it in account mode too so an old link keeps working.
    subjectBySlug: (slug) => slugs.get(slug) ?? subjects.get(slug),
    chapterById: (id) => chapters.get(id),
    groupByName: (name) => groups.get(name),
    stale: parts.stale ?? false, error: parts.error ?? null, issues: parts.issues ?? [], retry: parts.retry ?? (() => undefined), library: parts.library,
  };
}

/** An account curriculum that has not loaded: deliberately EMPTY. Account progress must never attach to the sample chapters. */
export const emptyAccountTree = (): CurriculumTree => ({ identity: EMPTY_IDENTITY, groups: [], subjects: [], sections: [], chapters: [], weightages: [] });

export const CurriculumContext = createContext<CurriculumValue | null>(null);

let bundledValue: CurriculumValue | null = null;
/** Used when no provider is mounted (for example a component rendered on its own in a test): the bundled sample, as before. */
export function bundledCurriculumValue(library: LibraryAdapter): CurriculumValue {
  bundledValue ??= makeCurriculumValue({ status: 'ready', tree: BUNDLED_CURRICULUM, library });
  return bundledValue;
}

export function useCurriculum(): CurriculumValue {
  const value = useContext(CurriculumContext);
  if (value) return value;
  throw new Error('useCurriculum must be used inside <CurriculumProvider>.');
}
