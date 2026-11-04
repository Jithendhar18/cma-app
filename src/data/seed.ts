import { CHAPTER_SEEDS, SUBJECTS } from '@/data/subjects';
import { addDaysISO } from '@/lib/dates';
import type {
  Chapter,
  Priority,
  RevisionNumber,
  RevisionTask,
  Settings,
  StudyDataSnapshot,
  StudyLog,
  StudySession,
} from '@/types/study';

const SAMPLE_EXAM_DATE = '2026-12-18';
const SAMPLE_FINAL_REVISION = '2026-12-05';

/** Offsets are days relative to today. completedOffset null means still pending. */
const REVISION_SEEDS: Array<{
  chapterId: string;
  revisionNumber: RevisionNumber;
  dueOffset: number;
  completedOffset: number | null;
  priority: Priority;
}> = [
  { chapterId: 'p5-3', revisionNumber: 1, dueOffset: 0, completedOffset: null, priority: 'high' },
  { chapterId: 'p6-3', revisionNumber: 1, dueOffset: 0, completedOffset: null, priority: 'high' },
  { chapterId: 'p8-1', revisionNumber: 2, dueOffset: -1, completedOffset: null, priority: 'high' },
  { chapterId: 'p12-2', revisionNumber: 1, dueOffset: -3, completedOffset: null, priority: 'high' },
  { chapterId: 'p10-4', revisionNumber: 1, dueOffset: 1, completedOffset: null, priority: 'medium' },
  { chapterId: 'p7-2', revisionNumber: 2, dueOffset: 2, completedOffset: null, priority: 'medium' },
  { chapterId: 'p11-1', revisionNumber: 3, dueOffset: 3, completedOffset: null, priority: 'low' },
  { chapterId: 'p6-2', revisionNumber: 2, dueOffset: -2, completedOffset: -2, priority: 'medium' },
  { chapterId: 'p7-1', revisionNumber: 1, dueOffset: -14, completedOffset: -13, priority: 'medium' },
  { chapterId: 'p8-2', revisionNumber: 1, dueOffset: -10, completedOffset: -10, priority: 'low' },
];

const CHAPTER_NOTES: Record<string, string> = {
  'p6-3': 'Practise the direct-method operating cash flow schedule. Revisit Ind AS 7 examples before the mock.',
  'p5-4': 'Focus on dishonour and presentment rules; create a one-page summary of liabilities.',
  'p8-3': 'Idle time and overtime premium are frequent MCQ traps. Re-solve the 2023 question set.',
};

function buildChapters(today: string): Chapter[] {
  return SUBJECTS.flatMap((subject) =>
    (CHAPTER_SEEDS[subject.id] ?? []).map(
      ([title, estimatedHours, status, confidence, actualHours, questions, accuracy, daysAgo], index) => {
        const id = `${subject.id}-${index + 1}`;
        return {
          id,
          subjectId: subject.id,
          order: index + 1,
          title,
          status,
          estimatedHours,
          actualHours,
          confidence,
          questionsPracticed: questions,
          correctAnswers: Math.round((questions * accuracy) / 100),
          lastStudied: daysAgo === null ? null : addDaysISO(today, -daysAgo),
          notes: CHAPTER_NOTES[id] ?? '',
        };
      },
    ),
  );
}

function buildRevisions(today: string): RevisionTask[] {
  return REVISION_SEEDS.map((seed, index) => ({
    id: `rev-${index + 1}`,
    chapterId: seed.chapterId,
    revisionNumber: seed.revisionNumber,
    dueDate: addDaysISO(today, seed.dueOffset),
    completedOn: seed.completedOffset === null ? null : addDaysISO(today, seed.completedOffset),
    priority: seed.priority,
  }));
}

function buildSessions(today: string): StudySession[] {
  const yesterday = addDaysISO(today, -1);
  return [
    { id: 's-1', date: today, subjectId: 'p6', chapterId: 'p6-3', startTime: '18:00', durationMinutes: 90, status: 'completed' },
    { id: 's-2', date: today, subjectId: 'p5', chapterId: 'p5-3', startTime: '19:30', durationMinutes: 60, status: 'in_progress' },
    { id: 's-3', date: today, subjectId: 'p8', chapterId: 'p8-3', startTime: '20:30', durationMinutes: 90, status: 'upcoming' },
    { id: 's-4', date: today, subjectId: 'p7', chapterId: 'p7-3', startTime: '22:00', durationMinutes: 60, status: 'upcoming' },
    { id: 's-5', date: yesterday, subjectId: 'p9', chapterId: 'p9-3', startTime: '18:00', durationMinutes: 60, status: 'missed' },
  ];
}

/** Minutes studied, index 0 = today, index n = n days ago. */
const STUDY_HISTORY_MINUTES = [275, 410, 365, 440, 300, 0, 390, 420, 480, 355, 210, 400, 445, 380];

function buildStudyLog(today: string): StudyLog {
  return STUDY_HISTORY_MINUTES.reduce<StudyLog>((log, minutes, daysAgo) => {
    if (minutes > 0) log[addDaysISO(today, -daysAgo)] = minutes;
    return log;
  }, {});
}

function buildSettings(): Settings {
  return {
    name: 'Jithendhar',
    course: 'CMA Intermediate',
    examAttempt: 'December 2026',
    examDate: SAMPLE_EXAM_DATE,
    examDateIsSample: true,
    finalRevisionDate: SAMPLE_FINAL_REVISION,
    examGroups: ['Group I', 'Group II'],
    dailyTargetHours: 8,
    weeklyTargetHours: 50,
    studyStartTime: '06:00',
    studyEndTime: '23:00',
    pomodoroFocusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 20,
    theme: 'dark',
  };
}

export function createSeedData(today: string): StudyDataSnapshot {
  return {
    settings: buildSettings(),
    chapters: buildChapters(today),
    sessions: buildSessions(today),
    revisions: buildRevisions(today),
    studyLog: buildStudyLog(today),
  };
}
