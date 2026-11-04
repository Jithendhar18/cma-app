export type PaperGroup = 'Group I' | 'Group II';

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
}

export interface PracticeRecord {
  id: string;
  date: string;
  chapterId: string;
  subjectId: string;
  questions: number;
  correct: number;
}

export interface MockExam {
  id: string;
  date: string;
  subjectId: string;
  name: string;
  score: number;
  maxScore: number;
}

export interface RevisionTask {
  id: string;
  chapterId: string;
  revisionNumber: RevisionNumber;
  dueDate: string;
  completedOn: string | null;
  priority: Priority;
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

export interface StudyDataSnapshot {
  settings: Settings;
  chapters: Chapter[];
  sessions: StudySession[];
  revisions: RevisionTask[];
  focusLog: FocusRecord[];
  mockExams: MockExam[];
  practiceLog: PracticeRecord[];
}
