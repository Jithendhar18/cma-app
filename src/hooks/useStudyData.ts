import { useMemo } from 'react';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
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

/** Subjects of the curriculum in effect, by id. (Replaces the old module-level map built from the bundled sample.) */
export function useSubjectMap() {
  const { subjects } = useCurriculum();
  return useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
}

export function useChapterMap() {
  const chapters = useStudyStore((s) => s.chapters);
  return useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);
}
