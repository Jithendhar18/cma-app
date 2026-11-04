import type {
  Chapter,
  ChapterStatus,
  Priority,
  RevisionTask,
  SessionStatus,
  StudyLog,
  Subject,
} from '@/types/study';
import { addDaysISO, parseISODate, weekDatesISO } from '@/lib/dates';

const DONE_STATUSES: ChapterStatus[] = ['completed', 'revision_due', 'exam_ready'];

export const isChapterDone = (chapter: Chapter) => DONE_STATUSES.includes(chapter.status);

export function chapterAccuracy(chapter: Chapter): number | null {
  if (chapter.questionsPracticed === 0) return null;
  return (chapter.correctAnswers / chapter.questionsPracticed) * 100;
}

export function averageAccuracy(chapters: Chapter[]): number | null {
  const questions = chapters.reduce((sum, c) => sum + c.questionsPracticed, 0);
  if (questions === 0) return null;
  const correct = chapters.reduce((sum, c) => sum + c.correctAnswers, 0);
  return (correct / questions) * 100;
}

export interface SubjectStats {
  total: number;
  done: number;
  completionPct: number;
  actualHours: number;
  estimatedHours: number;
  accuracy: number | null;
  revisionsDone: number;
  revisionsTotal: number;
}

export function subjectStats(
  subjectId: string,
  chapters: Chapter[],
  revisions: RevisionTask[],
): SubjectStats {
  const own = chapters.filter((c) => c.subjectId === subjectId);
  const ids = new Set(own.map((c) => c.id));
  const ownRevisions = revisions.filter((r) => ids.has(r.chapterId));
  const done = own.filter(isChapterDone).length;
  return {
    total: own.length,
    done,
    completionPct: own.length === 0 ? 0 : (done / own.length) * 100,
    actualHours: own.reduce((sum, c) => sum + c.actualHours, 0),
    estimatedHours: own.reduce((sum, c) => sum + c.estimatedHours, 0),
    accuracy: averageAccuracy(own),
    revisionsDone: ownRevisions.filter((r) => r.completedOn).length,
    revisionsTotal: ownRevisions.length,
  };
}

export interface WeakArea {
  chapter: Chapter;
  subject: Subject;
  accuracy: number | null;
  action: string;
}

export function weakAreas(chapters: Chapter[], subjects: Subject[], limit: number): WeakArea[] {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  return chapters
    .filter((c) => c.status !== 'not_started')
    .map((chapter) => ({ chapter, accuracy: chapterAccuracy(chapter) }))
    .filter(({ chapter, accuracy }) => chapter.confidence <= 2 || (accuracy !== null && accuracy < 60))
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
    .slice(0, limit)
    .map(({ chapter, accuracy }) => ({
      chapter,
      subject: subjectById.get(chapter.subjectId)!,
      accuracy,
      action: recommendedAction(chapter, accuracy),
    }));
}

function recommendedAction(chapter: Chapter, accuracy: number | null): string {
  if (accuracy !== null && accuracy < 50) return 'Review wrong answers, then solve 20 fresh questions';
  if (chapter.confidence <= 2) return 'Re-read the notes and solve a 30-minute drill';
  return 'Attempt a timed mini-test to lift accuracy';
}

export const CONFIDENCE_LABELS: Record<Chapter['confidence'], string> = {
  1: 'Very low',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Very high',
};

export function todayMinutes(studyLog: StudyLog, today: string): number {
  return studyLog[today] ?? 0;
}

export function weeklySeries(studyLog: StudyLog, today: string) {
  return weekDatesISO(today).map((date) => ({
    date,
    minutes: studyLog[date] ?? 0,
    isFuture: date > today,
  }));
}

export function lastNDaysMinutes(studyLog: StudyLog, today: string, days: number): number[] {
  return Array.from({ length: days }, (_, i) => studyLog[addDaysISO(today, i - (days - 1))] ?? 0);
}

export function studyStreak(studyLog: StudyLog, today: string): number {
  let streak = 0;
  let cursor = (studyLog[today] ?? 0) > 0 ? today : addDaysISO(today, -1);
  while ((studyLog[cursor] ?? 0) > 0) {
    streak += 1;
    cursor = addDaysISO(cursor, -1);
  }
  return streak;
}

export function totalMinutes(studyLog: StudyLog): number {
  return Object.values(studyLog).reduce((sum, minutes) => sum + minutes, 0);
}

export function daysUntil(isoDate: string, today: string): number {
  const ms = parseISODate(isoDate).getTime() - parseISODate(today).getTime();
  return Math.round(ms / 86_400_000);
}

export type RevisionBucket = 'overdue' | 'today' | 'upcoming' | 'completed';

export function revisionBucket(task: RevisionTask, today: string): RevisionBucket {
  if (task.completedOn) return 'completed';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return 'upcoming';
}

const revisionRank = (n: RevisionTask['revisionNumber']) => (n === 'final' ? 4 : n);

export function previousRevisionDate(task: RevisionTask, revisions: RevisionTask[]): string | null {
  const previous = revisions
    .filter((r) => r.chapterId === task.chapterId && r.completedOn)
    .filter((r) => revisionRank(r.revisionNumber) < revisionRank(task.revisionNumber))
    .sort((a, b) => (b.completedOn ?? '').localeCompare(a.completedOn ?? ''));
  return previous[0]?.completedOn ?? null;
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function sessionStatusLabel(status: SessionStatus): string {
  return { upcoming: 'Upcoming', in_progress: 'In progress', completed: 'Completed', missed: 'Missed' }[status];
}
