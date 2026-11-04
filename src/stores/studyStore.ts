import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSeedData } from '@/data/seed';
import { addDaysISO, todayISO } from '@/lib/dates';
import type {
  Chapter,
  ChapterStatus,
  RevisionTask,
  SessionStatus,
  Settings,
  StudyDataSnapshot,
} from '@/types/study';

export type ChapterPatch = Partial<Pick<Chapter, 'status' | 'confidence' | 'notes'>>;

interface StudyActions {
  updateSettings: (patch: Partial<Settings>) => void;
  updateChapter: (chapterId: string, patch: ChapterPatch) => void;
  logStudyTime: (chapterId: string, minutes: number) => void;
  logPractice: (chapterId: string, questions: number, correct: number) => void;
  completeRevision: (revisionId: string) => void;
  rescheduleRevision: (revisionId: string, dueDate: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  importData: (snapshot: StudyDataSnapshot) => void;
  resetDemoData: () => void;
}

export type StudyStore = StudyDataSnapshot & StudyActions;

const CHAPTER_DONE_STATUSES: ChapterStatus[] = ['completed', 'revision_due', 'exam_ready'];

function nextRevisionAfter(task: RevisionTask, settings: Settings): Omit<RevisionTask, 'id' | 'chapterId' | 'priority'> | null {
  const completed = task.completedOn ?? todayISO();
  switch (task.revisionNumber) {
    case 1:
      return { revisionNumber: 2, dueDate: addDaysISO(completed, 7), completedOn: null };
    case 2:
      return { revisionNumber: 3, dueDate: addDaysISO(completed, 21), completedOn: null };
    case 3:
      return { revisionNumber: 'final', dueDate: settings.finalRevisionDate, completedOn: null };
    default:
      return null;
  }
}

function withChapter(chapters: Chapter[], chapterId: string, change: (chapter: Chapter) => Chapter): Chapter[] {
  return chapters.map((chapter) => (chapter.id === chapterId ? change(chapter) : chapter));
}

function addMinutes(log: StudyDataSnapshot['studyLog'], date: string, minutes: number) {
  return { ...log, [date]: (log[date] ?? 0) + minutes };
}

const createInitialState = (): StudyDataSnapshot => createSeedData(todayISO());

export const useStudyStore = create<StudyStore>()(
  persist(
    (set) => ({
      ...createInitialState(),

      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      updateChapter: (chapterId, patch) =>
        set((state) => {
          const current = state.chapters.find((c) => c.id === chapterId);
          if (!current) return state;

          const becameDone =
            patch.status !== undefined &&
            CHAPTER_DONE_STATUSES.includes(patch.status) &&
            !CHAPTER_DONE_STATUSES.includes(current.status);
          const hasRevisions = state.revisions.some((r) => r.chapterId === chapterId);

          const revisions =
            becameDone && !hasRevisions
              ? [
                  ...state.revisions,
                  {
                    id: `rev-${crypto.randomUUID()}`,
                    chapterId,
                    revisionNumber: 1 as const,
                    dueDate: addDaysISO(todayISO(), 1),
                    completedOn: null,
                    priority: 'medium' as const,
                  },
                ]
              : state.revisions;

          return {
            chapters: withChapter(state.chapters, chapterId, (c) => ({ ...c, ...patch })),
            revisions,
          };
        }),

      logStudyTime: (chapterId, minutes) =>
        set((state) => {
          const today = todayISO();
          return {
            chapters: withChapter(state.chapters, chapterId, (c) => ({
              ...c,
              actualHours: c.actualHours + minutes / 60,
              lastStudied: today,
              status: c.status === 'not_started' ? 'learning' : c.status,
            })),
            studyLog: addMinutes(state.studyLog, today, minutes),
          };
        }),

      logPractice: (chapterId, questions, correct) =>
        set((state) => ({
          chapters: withChapter(state.chapters, chapterId, (c) => ({
            ...c,
            questionsPracticed: c.questionsPracticed + questions,
            correctAnswers: c.correctAnswers + correct,
            lastStudied: todayISO(),
          })),
        })),

      completeRevision: (revisionId) =>
        set((state) => {
          const task = state.revisions.find((r) => r.id === revisionId);
          if (!task || task.completedOn) return state;

          const completed = { ...task, completedOn: todayISO() };
          const next = nextRevisionAfter(completed, state.settings);
          const alreadyScheduled =
            next !== null &&
            state.revisions.some(
              (r) => r.chapterId === task.chapterId && r.revisionNumber === next.revisionNumber && !r.completedOn,
            );

          const revisions = state.revisions.map((r) => (r.id === revisionId ? completed : r));
          if (next && !alreadyScheduled) {
            revisions.push({
              ...next,
              id: `rev-${crypto.randomUUID()}`,
              chapterId: task.chapterId,
              priority: task.priority,
            });
          }
          return { revisions };
        }),

      rescheduleRevision: (revisionId, dueDate) =>
        set((state) => ({
          revisions: state.revisions.map((r) => (r.id === revisionId ? { ...r, dueDate } : r)),
        })),

      setSessionStatus: (sessionId, status) =>
        set((state) => {
          const session = state.sessions.find((s) => s.id === sessionId);
          if (!session || session.status === status) return state;

          const sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s));
          if (status !== 'completed' || session.status === 'completed') return { sessions };

          const minutes = session.durationMinutes;
          return {
            sessions,
            studyLog: addMinutes(state.studyLog, session.date, minutes),
            chapters: withChapter(state.chapters, session.chapterId, (c) => ({
              ...c,
              actualHours: c.actualHours + minutes / 60,
              lastStudied: session.date,
            })),
          };
        }),

      importData: (snapshot) => set(() => snapshot),

      resetDemoData: () => set(() => createInitialState()),
    }),
    {
      name: 'cma-study-os',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        chapters: state.chapters,
        sessions: state.sessions,
        revisions: state.revisions,
        studyLog: state.studyLog,
      }),
    },
  ),
);
