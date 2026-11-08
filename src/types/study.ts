/** The two Intermediate groups, but any group name the database publishes is accepted (the `string & {}` keeps autocompletion). */
export type PaperGroup = 'Group I' | 'Group II' | (string & {});

export type ChapterStatus =
  | 'not_started'
  | 'learning'
  | 'practising'
  | 'completed'
  | 'revision_due'
  | 'exam_ready';

export type ConfidenceLevel = 1 | 2 | 3 | 4 | 5;

export type SessionStatus = 'upcoming' | 'in_progress' | 'completed' | 'missed';

export type Priority = 'high' | 'medium' | 'low';

export type RevisionNumber = 1 | 2 | 3 | 'final';

export type ThemeMode = 'dark' | 'light' | 'system';

export interface Subject {
  id: string;
  /** URL segment for the subject page. Bundled subjects use their id ('p5'); account subjects use the database slug. */
  slug?: string;
  paperNumber: number;
  name: string;
  shortName: string;
  group: PaperGroup;
}

export interface Chapter {
  id: string;
  subjectId: string;
  order: number;
  title: string;
  status: ChapterStatus;
  estimatedHours: number;
  actualHours: number;
  confidence: ConfidenceLevel;
  questionsPracticed: number;
  correctAnswers: number;
  lastStudied: string | null;
  /** Date the chapter first reached a completed state. */
  completedOn?: string | null;
  /** True while lastStudied/completedOn are untouched demo dates that may be rolled forward. */
  demo?: boolean;
  notes: string;
}

export interface StudySession {
  id: string;
  date: string;
  subjectId: string;
  chapterId: string;
  startTime: string;
  durationMinutes: number;
  status: SessionStatus;
  priority: Priority;
  notes: string;
  /** Untouched demo record; dates may be rolled forward. Cleared when the user edits it. */
  demo?: boolean;
}

export type FocusMode = 'pomodoro' | 'stopwatch' | 'planner';

/** One block of actually-focused time. The single source of truth for study hours. */
export interface FocusRecord {
  id: string;
  date: string;
  subjectId: string;
  chapterId: string;
  minutes: number;
  mode: FocusMode;
  notes: string;
  sessionId: string | null;
  demo?: boolean;
}

export interface PracticeRecord {
  id: string;
  date: string;
  chapterId: string;
  subjectId: string;
  questions: number;
  correct: number;
  demo?: boolean;
}

export interface MockExam {
  id: string;
  date: string;
  subjectId: string;
  name: string;
  score: number;
  maxScore: number;
  demo?: boolean;
}

export interface RevisionTask {
  id: string;
  chapterId: string;
  revisionNumber: RevisionNumber;
  dueDate: string;
  completedOn: string | null;
  priority: Priority;
  /** Set when the chapter was marked incomplete. Cancelled tasks are kept as history only. */
  cancelledOn?: string | null;
  demo?: boolean;
}

export interface Settings {
  name: string;
  course: string;
  examAttempt: string;
  examDate: string;
  examDateIsSample: boolean;
  finalRevisionDate: string;
  examGroups: PaperGroup[];
  dailyTargetHours: number;
  weeklyTargetHours: number;
  studyStartTime: string;
  studyEndTime: string;
  pomodoroFocusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  avatar: string | null;
  theme: ThemeMode;
}

/** Focused minutes keyed by ISO date (YYYY-MM-DD). */
export type StudyLog = Record<string, number>;

export interface SnapshotMeta {
  /** Date the demo content was last anchored to. Null when there is no demo content to refresh. */
  seedAnchor: string | null;
}

export interface StudyDataSnapshot {
  settings: Settings;
  chapters: Chapter[];
  sessions: StudySession[];
  revisions: RevisionTask[];
  focusLog: FocusRecord[];
  mockExams: MockExam[];
  practiceLog: PracticeRecord[];
  meta: SnapshotMeta;
}
