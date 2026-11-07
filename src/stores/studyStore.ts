import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSeedData } from '@/data/seed';
import { addDaysISO, todayISO } from '@/lib/dates';
import { rollDemoForward } from '@/lib/demoRoll';
import { splitPlannedSession } from '@/lib/focusSplit';
import { loadSnapshot } from '@/lib/loadSnapshot';
import { isPending, nextRevisionNumber } from '@/lib/revisions';
import { backupCorrupt, createSafeStorage } from '@/lib/safeStorage';
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
  /** Moves untouched demo records forward to today. Never touches user-created or edited records. */
  refreshDemoDates: () => void;
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

/** Due date for a revision created because a chapter was (re)completed today. */
function dueDateFor(number: RevisionTask['revisionNumber'], today: string, settings: Settings): string {
  switch (number) {
    case 1:
      return addDaysISO(today, 1);
    case 2:
      return addDaysISO(today, 7);
    case 3:
      return addDaysISO(today, 21);
    default:
      return settings.finalRevisionDate > today ? settings.finalRevisionDate : addDaysISO(today, 1);
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
    demo: false,
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
          const today = todayISO();

          const wasDone = CHAPTER_DONE_STATUSES.includes(current.status);
          const willBeDone = patch.status === undefined ? wasDone : CHAPTER_DONE_STATUSES.includes(patch.status);
          const becameDone = !wasDone && willBeDone;
          const becameIncomplete = wasDone && !willBeDone;

          let revisions = state.revisions;
          if (becameIncomplete) {
            // History stays: completed revisions are kept, pending ones are cancelled (not deleted).
            revisions = revisions.map((r) =>
              r.chapterId === chapterId && isPending(r) ? { ...r, cancelledOn: today, demo: false } : r,
            );
          }
          if (becameDone && !revisions.some((r) => r.chapterId === chapterId && isPending(r))) {
            const number = nextRevisionNumber(revisions, chapterId);
            if (number !== null) {
              revisions = [
                ...revisions,
                {
                  id: newId('rev'),
                  chapterId,
                  revisionNumber: number,
                  dueDate: dueDateFor(number, today, state.settings),
                  completedOn: null,
                  priority: 'medium' as const,
                },
              ];
            }
          }

          return {
            chapters: withChapter(state.chapters, chapterId, (c) => ({
              ...c,
              ...patch,
              completedOn: becameDone ? today : becameIncomplete ? null : (c.completedOn ?? null),
              demo: false,
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
            demo: false,
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
          sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch, demo: false } : s)),
          // Time already logged against this session must stay on the same dates as the session.
          focusLog: state.focusLog.map((r) => (r.sessionId === sessionId ? { ...r, demo: false } : r)),
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

          const sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, status, demo: false } : s));
          const focusLog = state.focusLog.map((r) => (r.sessionId === sessionId ? { ...r, demo: false } : r));
          const plannerPrefix = `plan-${sessionId}`;
          const isPlannerRecord = (id: string) => id === plannerPrefix || id.startsWith(`${plannerPrefix}@`);
          const logged = state.focusLog.some((r) => r.sessionId === sessionId);

          if (status === 'completed' && !logged) {
            // A session that runs past midnight is credited to each calendar day it covers.
            const parts = splitPlannedSession(session.date, session.startTime, session.durationMinutes);
            const records: FocusRecord[] = parts.map((part, i) => ({
              id: i === 0 ? plannerPrefix : `${plannerPrefix}@${part.date}`,
              date: part.date,
              subjectId: session.subjectId,
              chapterId: session.chapterId,
              minutes: part.minutes,
              mode: 'planner',
              notes: session.notes,
              sessionId,
            }));
            return {
              sessions,
              focusLog: [...focusLog, ...records],
              chapters: records.reduce((chapters, record) => applyRecord(chapters, record, 1), state.chapters),
            };
          }

          if (session.status === 'completed' && status !== 'completed') {
            // Un-completing only removes time that the planner itself credited.
            const planned = state.focusLog.filter((r) => isPlannerRecord(r.id));
            if (planned.length > 0) {
              return {
                sessions,
                focusLog: focusLog.filter((r) => !isPlannerRecord(r.id)),
                chapters: planned.reduce((chapters, record) => applyRecord(chapters, record, -1), state.chapters),
              };
            }
          }
          return { sessions, focusLog };
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
          if (!task || task.completedOn || task.cancelledOn) return state;

          const completed = { ...task, completedOn: todayISO(), demo: false };
          const next = nextRevisionAfter(completed, state.settings);
          const alreadyScheduled =
            next !== null &&
            state.revisions.some(
              (r) => r.chapterId === task.chapterId && r.revisionNumber === next.revisionNumber && isPending(r),
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
              demo: false,
              status: c.status === 'revision_due' ? 'completed' : c.status,
            })),
          };
        }),

      rescheduleRevision: (revisionId, dueDate) =>
        set((state) => ({
          revisions: state.revisions.map((r) => (r.id === revisionId && isPending(r) ? { ...r, dueDate, demo: false } : r)),
        })),

      addMockExam: (exam) => set((state) => ({ mockExams: [...state.mockExams, { ...exam, id: newId('m') }] })),

      deleteMockExam: (examId) => set((state) => ({ mockExams: state.mockExams.filter((m) => m.id !== examId) })),

      importData: (snapshot) => set(() => snapshot),

      refreshDemoDates: () =>
        set((state) => {
          const snapshot: StudyDataSnapshot = {
            settings: state.settings, chapters: state.chapters, sessions: state.sessions, revisions: state.revisions,
            focusLog: state.focusLog, mockExams: state.mockExams, practiceLog: state.practiceLog, meta: state.meta,
          };
          const rolled = rollDemoForward(snapshot, todayISO());
          return rolled === snapshot ? state : rolled;
        }),

      resetDemoData: () => set(() => createInitialState()),
    }),
    {
      name: 'cma-study-os',
      version: 3,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({
        settings: state.settings,
        chapters: state.chapters,
        sessions: state.sessions,
        revisions: state.revisions,
        focusLog: state.focusLog,
        mockExams: state.mockExams,
        practiceLog: state.practiceLog,
        meta: state.meta,
      }),
      // Older saved data is upgraded in `merge`, never discarded here.
      migrate: (persisted) => persisted as StudyStore,
      merge: (persisted, current) => {
        // Nothing usable was stored (empty, or unreadable and already backed up by the storage layer).
        if (persisted === undefined || persisted === null) return current;
        const result = loadSnapshot(persisted, todayISO());
        if (result.ok) return { ...current, ...result.data };
        // Unusable data falls back to the demo for this session, but the original is kept aside.
        try {
          backupCorrupt(localStorage, 'cma-study-os', JSON.stringify(persisted));
        } catch {
          /* ignore */
        }
        return current;
      },
    },
  ),
);
