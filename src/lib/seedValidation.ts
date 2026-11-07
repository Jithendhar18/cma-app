import { SUBJECTS } from '@/data/subjects';
import type { StudyDataSnapshot } from '@/types/study';

const DONE = ['completed', 'revision_due', 'exam_ready'];
const RANK = { 1: 1, 2: 2, 3: 3, final: 4 } as const;

/**
 * Cross-checks a snapshot for internal contradictions. Returns human-readable problems; an empty
 * list means the data is consistent. Used by tests and available for diagnostics.
 */
export function validateConsistency(data: StudyDataSnapshot, options: { checkTotals?: boolean } = {}): string[] {
  const { checkTotals = true } = options;
  const problems: string[] = [];
  const chapterById = new Map(data.chapters.map((c) => [c.id, c]));
  const subjectIds = new Set(SUBJECTS.map((s) => s.id));

  const dupes = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    ids.forEach((id) => {
      if (seen.has(id)) problems.push(`Duplicate ${label} id: ${id}`);
      seen.add(id);
    });
  };
  dupes('chapter', data.chapters.map((c) => c.id));
  dupes('session', data.sessions.map((s) => s.id));
  dupes('focus record', data.focusLog.map((r) => r.id));
  dupes('practice record', data.practiceLog.map((r) => r.id));
  dupes('revision', data.revisions.map((r) => r.id));
  dupes('mock exam', data.mockExams.map((m) => m.id));

  const refCheck = (label: string, id: string, chapterId: string, subjectId: string) => {
    const chapter = chapterById.get(chapterId);
    if (!chapter) problems.push(`${label} ${id} references missing chapter ${chapterId}`);
    else if (chapter.subjectId !== subjectId) problems.push(`${label} ${id} subject ${subjectId} does not match chapter ${chapterId}`);
  };
  data.sessions.forEach((s) => refCheck('Session', s.id, s.chapterId, s.subjectId));
  data.focusLog.forEach((r) => refCheck('Focus record', r.id, r.chapterId, r.subjectId));
  data.practiceLog.forEach((r) => refCheck('Practice record', r.id, r.chapterId, r.subjectId));
  data.mockExams.forEach((m) => {
    if (!subjectIds.has(m.subjectId)) problems.push(`Mock exam ${m.id} references missing subject ${m.subjectId}`);
  });
  data.revisions.forEach((r) => {
    if (!chapterById.has(r.chapterId)) problems.push(`Revision ${r.id} references missing chapter ${r.chapterId}`);
  });

  if (checkTotals) {
    for (const chapter of data.chapters) {
      const minutes = data.focusLog.filter((r) => r.chapterId === chapter.id).reduce((s, r) => s + r.minutes, 0);
      if (Math.abs(chapter.actualHours * 60 - minutes) > 0.5) {
        problems.push(`Chapter ${chapter.id} has ${(chapter.actualHours * 60).toFixed(1)} min but focus history sums to ${minutes}`);
      }
      const own = data.practiceLog.filter((r) => r.chapterId === chapter.id);
      const q = own.reduce((s, r) => s + r.questions, 0);
      const c = own.reduce((s, r) => s + r.correct, 0);
      if (chapter.questionsPracticed !== q) problems.push(`Chapter ${chapter.id} questions ${chapter.questionsPracticed} != practice log ${q}`);
      if (chapter.correctAnswers !== c) problems.push(`Chapter ${chapter.id} correct ${chapter.correctAnswers} != practice log ${c}`);
      const dates = [...data.focusLog.filter((r) => r.chapterId === chapter.id), ...own].map((r) => r.date).sort();
      const latest = dates[dates.length - 1] ?? null;
      if (latest !== chapter.lastStudied) problems.push(`Chapter ${chapter.id} lastStudied ${chapter.lastStudied} != latest record ${latest}`);
    }
  }

  data.practiceLog.forEach((r) => {
    if (r.correct > r.questions || r.correct < 0) problems.push(`Practice record ${r.id} has invalid correct count`);
  });

  // Revisions: gap-free per chapter, not before completion, and only for completed chapters.
  const byChapter = new Map<string, typeof data.revisions>();
  data.revisions.filter((r) => !r.cancelledOn).forEach((r) => byChapter.set(r.chapterId, [...(byChapter.get(r.chapterId) ?? []), r]));
  byChapter.forEach((list, chapterId) => {
    const chapter = chapterById.get(chapterId);
    if (chapter && !DONE.includes(chapter.status)) problems.push(`Chapter ${chapterId} is not complete but has active revisions`);
    const ranks = list.map((r) => RANK[r.revisionNumber]).sort();
    ranks.forEach((rank, i) => {
      if (rank !== i + 1) problems.push(`Chapter ${chapterId} revision numbers have a gap or duplicate: ${ranks.join(',')}`);
    });
    if (chapter?.completedOn) {
      // Completed revisions are history and may predate a later re-completion; only pending ones must follow it.
      list.filter((r) => !r.completedOn).forEach((r) => {
        if (r.dueDate < chapter.completedOn!) problems.push(`Revision ${r.id} is due before chapter ${chapterId} was completed`);
      });
    }
  });
  return problems;
}
