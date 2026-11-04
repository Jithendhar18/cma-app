import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSeedData } from '@/data/seed';
import { addDaysISO, todayISO } from '@/lib/dates';
import { parseSnapshot } from '@/lib/snapshot';
import type {
  Chapter,
  ChapterStatus,
  FocusRecord,
  MockExam,
  PracticeRecord,
  RevisionTask,
  SessionStatus,
  Settings,
  StudyDataSnapshot,
  StudySession,
} from '@/types/study';

export type ChapterPatch = Partial<Pick<Chapter, 'status' | 'confidence' | 'notes'>>;
export type NewSession = Omit<StudySession, 'id'>;

interface StudyActions {
  updateSettings: (patch: Partial<Settings>) => void;
  updateChapter: (chapterId: string, patch: ChapterPatch) => void;
  logPractice: (chapterId: string, questions: number, correct: number) => void;
  addSession: (session: NewSession) => string;
  updateSession: (sessionId: string, patch: Partial<NewSession>) => void;
  deleteSession: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /** Idempotent: a record id that already exists is ignored. */
  addFocusRecord: (record: FocusRecord) => void;
  removeFocusRecord: (recordId: string) => void;
  completeRevision: (revisionId: string) => void;
  rescheduleRevision: (revisionId: string, dueDate: string) => void;
  addMockExam: (exam: Omit<MockExam, 'id'>) => void;
  deleteMockExam: (examId: string) => void;
  importData: (snapshot: StudyDataSnapshot) => void;
  resetDemoData: () => void;
}

export type StudyStore = StudyDataSnapshot & StudyActions;

export const CHAPTER_DONE_STATUSES: ChapterStatus[] = ['completed', 'revision_due', 'exam_ready'];

type NextRevision = Omit<RevisionTask, 'id' | 'chapterId' | 'priority'>;

function nextRevisionAfter(task: RevisionTask, settings: Settings): NextRevision | null {
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

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function applyRecord(chapters: Chapter[], record: FocusRecord, direction: 1 | -1): Chapter[] {
  return withChapter(chapters, record.chapterId, (c) => ({
    ...c,
    actualHours: Math.max(0, c.actualHours + (direction * record.minutes) / 60),
    lastStudied: direction === 1 ? (c.lastStudied && c.lastStudied > record.date ? c.lastStudied : record.date) : c.lastStudied,
    status: direction === 1 && c.status === 'not_started' ? 'learning' : c.status,
  }));
}

const createInitialState = (): StudyDataSnapshot => createSeedData(todayISO());

export const useStudyStore = create<StudyStore>()(
  persist(
    (set) => ({
      ...createInitialState(),

      updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

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
                    id: newId('rev'),
                    chapterId,
                    revisionNumber: 1 as const,
                    dueDate: addDaysISO(todayISO(), 1),
                    completedOn: null,
                    priority: 'medium' as const,
                  },
                ]
              : state.revisions;

          return {
            chapters: withChapter(state.chapters, chapterId, (c) => ({
              ...c,
              ...patch,
              completedOn: becameDone ? todayISO() : c.completedOn ?? null,
            })),
            revisions,
          };
        }),

      logPractice: (chapterId, questions, correct) =>
        set((state) => ({
          practiceLog: [
            ...state.practiceLog,
            {
              id: newId('pr'),
              date: todayISO(),
              chapterId,
              subjectId: state.chapters.find((c) => c.id === chapterId)?.subjectId ?? '',
              questions,
              correct: Math.min(correct, questions),
            } satisfies PracticeRecord,
          ],
          chapters: withChapter(state.chapters, chapterId, (c) => ({
            ...c,
            questionsPracticed: c.questionsPracticed + questions,
            correctAnswers: c.correctAnswers + Math.min(correct, questions),
            lastStudied: todayISO(),
            status: c.status === 'not_started' ? 'learning' : c.status,
          })),
        })),

      addSession: (session) => {
        const id = newId('s');
        set((state) => ({ sessions: [...state.sessions, { ...session, id }] }));
        return id;
      },

      updateSession: (sessionId, patch) =>
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
        })),

      deleteSession: (sessionId) =>
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          // Keep logged time, but detach it from the removed plan.
          focusLog: state.focusLog.map((r) => (r.sessionId === sessionId ? { ...r, sessionId: null } : r)),
        })),

      setSessionStatus: (sessionId, status) =>
        set((state) => {
          const session = state.sessions.find((s) => s.id === sessionId);
          if (!session || session.status === status) return state;

          const sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s));
          const plannerId = `plan-${sessionId}`;
          const logged = state.focusLog.some((r) => r.sessionId === sessionId);

          if (status === 'completed' && !logged) {
            const record: FocusRecord = {
              id: plannerId,
              date: session.date,
              subjectId: session.subjectId,
              chapterId: session.chapterId,
              minutes: session.durationMinutes,
              mode: 'planner',
              notes: session.notes,
              sessionId,
            };
            return {
              sessions,
              focusLog: [...state.focusLog, record],
              chapters: applyRecord(state.chapters, record, 1),
            };
          }

          if (session.status === 'completed' && status !== 'completed') {
            // Un-completing only removes time that the planner itself credited.
            const planned = state.focusLog.find((r) => r.id === plannerId);
            if (planned) {
              return {
                sessions,
                focusLog: state.focusLog.filter((r) => r.id !== plannerId),
                chapters: applyRecord(state.chapters, planned, -1),
              };
            }
          }
          return { sessions };
        }),

      addFocusRecord: (record) =>
        set((state) => {
          if (record.minutes <= 0 || state.focusLog.some((r) => r.id === record.id)) return state;
          const linked = record.sessionId ? state.sessions.find((s) => s.id === record.sessionId) : undefined;
          return {
            focusLog: [...state.focusLog, record],
            chapters: applyRecord(state.chapters, record, 1),
            sessions: linked
              ? state.sessions.map((s) => (s.id === linked.id ? { ...s, status: 'completed' as const } : s))
              : state.sessions,
          };
        }),

      removeFocusRecord: (recordId) =>
        set((state) => {
          const record = state.focusLog.find((r) => r.id === recordId);
          if (!record) return state;
          return {
            focusLog: state.focusLog.filter((r) => r.id !== recordId),
            chapters: applyRecord(state.chapters, record, -1),
          };
        }),

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
            revisions.push({ ...next, id: newId('rev'), chapterId: task.chapterId, priority: task.priority });
          }
          return {
            revisions,
            chapters: withChapter(state.chapters, task.chapterId, (c) => ({
              ...c,
              lastStudied: todayISO(),
              status: c.status === 'revision_due' ? 'completed' : c.status,
            })),
          };
        }),

      rescheduleRevision: (revisionId, dueDate) =>
        set((state) => ({
          revisions: state.revisions.map((r) => (r.id === revisionId ? { ...r, dueDate } : r)),
        })),

      addMockExam: (exam) => set((state) => ({ mockExams: [...state.mockExams, { ...exam, id: newId('m') }] })),

      deleteMockExam: (examId) => set((state) => ({ mockExams: state.mockExams.filter((m) => m.id !== examId) })),

      importData: (snapshot) => set(() => snapshot),

      resetDemoData: () => set(() => createInitialState()),
    }),
    {
      name: 'cma-study-os',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        chapters: state.chapters,
        sessions: state.sessions,
        revisions: state.revisions,
        focusLog: state.focusLog,
        mockExams: state.mockExams,
        practiceLog: state.practiceLog,
      }),
      // Unknown or malformed stored data falls back to the seed instead of crashing.
      migrate: () => createInitialState(),
      merge: (persisted, current) => {
        const result = parseSnapshot(persisted);
        return result.ok ? { ...current, ...result.data } : current;
      },
    },
  ),
);
