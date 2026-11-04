import { useMemo } from 'react';
import { SUBJECTS } from '@/data/subjects';
import { buildStudyLog } from '@/lib/analytics';
import { todayISO } from '@/lib/dates';
import { useStudyStore } from '@/stores/studyStore';

/** Derived views shared by pages. All values are computed from the single store. */
export function useStudyLog() {
  const focusLog = useStudyStore((s) => s.focusLog);
  return useMemo(() => buildStudyLog(focusLog), [focusLog]);
}

export function useToday() {
  return todayISO();
}

export const subjectById = new Map(SUBJECTS.map((s) => [s.id, s]));

export function useChapterMap() {
  const chapters = useStudyStore((s) => s.chapters);
  return useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);
}
