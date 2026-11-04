import { CHAPTER_SEEDS, SUBJECTS } from '@/data/subjects';
import { addDaysISO } from '@/lib/dates';
import type {
  Chapter,
  Priority,
  RevisionNumber,
  RevisionTask,
  Settings,
  StudyDataSnapshot,
  FocusRecord,
  MockExam,
  PracticeRecord,
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
          completedOn: daysAgo !== null && ['completed', 'revision_due', 'exam_ready'].includes(status) ? addDaysISO(today, -(daysAgo + 2)) : null,
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
  const tomorrow = addDaysISO(today, 1);
  const base = { notes: '' };
  return [
    { ...base, id: 's-1', date: today, subjectId: 'p6', chapterId: 'p6-3', startTime: '18:00', durationMinutes: 90, status: 'completed', priority: 'high' },
    { ...base, id: 's-2', date: today, subjectId: 'p5', chapterId: 'p5-3', startTime: '19:30', durationMinutes: 60, status: 'in_progress', priority: 'high' },
    { ...base, id: 's-3', date: today, subjectId: 'p8', chapterId: 'p8-3', startTime: '20:30', durationMinutes: 90, status: 'upcoming', priority: 'medium' },
    { ...base, id: 's-4', date: today, subjectId: 'p7', chapterId: 'p7-3', startTime: '22:00', durationMinutes: 60, status: 'upcoming', priority: 'medium' },
    { ...base, id: 's-5', date: yesterday, subjectId: 'p9', chapterId: 'p9-3', startTime: '18:00', durationMinutes: 60, status: 'missed', priority: 'medium' },
    { ...base, id: 's-6', date: tomorrow, subjectId: 'p12', chapterId: 'p12-3', startTime: '07:00', durationMinutes: 120, status: 'upcoming', priority: 'high' },
    { ...base, id: 's-7', date: tomorrow, subjectId: 'p10', chapterId: 'p10-2', startTime: '10:00', durationMinutes: 90, status: 'upcoming', priority: 'medium' },
    { ...base, id: 's-8', date: addDaysISO(today, 2), subjectId: 'p11', chapterId: 'p11-3', startTime: '08:00', durationMinutes: 120, status: 'upcoming', priority: 'high' },
  ];
}

/** Minutes studied for the most recent days (index 0 = today). Older days are generated. */
const RECENT_MINUTES = [275, 410, 365, 440, 300, 0, 390, 420, 480, 355, 210, 400, 445, 380];
const HISTORY_DAYS = 90;

function minutesForDay(daysAgo: number): number {
  if (daysAgo < RECENT_MINUTES.length) return RECENT_MINUTES[daysAgo];
  if (daysAgo % 9 === 0) return 0;
  // Deterministic pseudo-variation between ~3h and ~8h, trending upward toward today.
  const wobble = ((daysAgo * 37) % 23) / 22;
  const trend = 1 - daysAgo / (HISTORY_DAYS * 1.6);
  return Math.round((180 + wobble * 270) * trend / 5) * 5;
}

function buildFocusLog(today: string, chapters: Chapter[]): FocusRecord[] {
  const studied = chapters.filter((c) => c.status !== 'not_started');
  const records: FocusRecord[] = [];
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo += 1) {
    let remaining = minutesForDay(daysAgo);
    if (remaining <= 0) continue;
    const date = addDaysISO(today, -daysAgo);
    let chunk = 0;
    if (daysAgo === 0) {
      // Matches today's completed planner session s-1.
      records.push({ id: 'f-today-s1', date, subjectId: 'p6', chapterId: 'p6-3', minutes: 90, mode: 'planner', notes: '', sessionId: 's-1' });
      remaining -= 90;
      chunk = 1;
    }
    while (remaining > 0) {
      const minutes = Math.min(remaining, chunk % 2 === 0 ? 100 : 75);
      const chapter = studied[(daysAgo * 3 + chunk * 7) % studied.length];
      records.push({
        id: `f-${daysAgo}-${chunk}`,
        date,
        subjectId: chapter.subjectId,
        chapterId: chapter.id,
        minutes,
        mode: chunk % 3 === 2 ? 'stopwatch' : 'pomodoro',
        notes: '',
        sessionId: null,
      });
      remaining -= minutes;
      chunk += 1;
    }
  }
  return records;
}

/** Sample practice history (demo data): a few attempts per studied chapter across recent weeks. */
function buildPracticeLog(today: string, chapters: Chapter[]): PracticeRecord[] {
  const records: PracticeRecord[] = [];
  chapters
    .filter((c) => c.questionsPracticed > 0)
    .forEach((chapter, index) => {
      const accuracy = chapter.correctAnswers / chapter.questionsPracticed;
      [2, 5, 9, 16, 24].forEach((daysAgo, i) => {
        const questions = 10 + ((index + i) % 4) * 5;
        records.push({
          id: `pr-${chapter.id}-${i}`,
          date: addDaysISO(today, -((daysAgo + index) % 28)),
          chapterId: chapter.id,
          subjectId: chapter.subjectId,
          questions,
          correct: Math.round(questions * accuracy),
        });
      });
    });
  return records;
}

/** Sample mock scores (demo data). */
function buildMockExams(today: string): MockExam[] {
  return [
    { id: 'm-1', date: addDaysISO(today, -42), subjectId: 'p6', name: 'Mock Test 1', score: 48, maxScore: 100 },
    { id: 'm-2', date: addDaysISO(today, -35), subjectId: 'p8', name: 'Mock Test 1', score: 55, maxScore: 100 },
    { id: 'm-3', date: addDaysISO(today, -28), subjectId: 'p5', name: 'Mock Test 1', score: 52, maxScore: 100 },
    { id: 'm-4', date: addDaysISO(today, -21), subjectId: 'p12', name: 'Mock Test 1', score: 46, maxScore: 100 },
    { id: 'm-5', date: addDaysISO(today, -14), subjectId: 'p6', name: 'Mock Test 2', score: 58, maxScore: 100 },
    { id: 'm-6', date: addDaysISO(today, -9), subjectId: 'p7', name: 'Mock Test 1', score: 61, maxScore: 100 },
    { id: 'm-7', date: addDaysISO(today, -4), subjectId: 'p8', name: 'Mock Test 2', score: 64, maxScore: 100 },
  ];
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
    longBreakEvery: 4,
    avatar: null,
    theme: 'dark',
  };
}

export function createSeedData(today: string): StudyDataSnapshot {
  const chapters = buildChapters(today);
  return {
    settings: buildSettings(),
    chapters,
    sessions: buildSessions(today),
    revisions: buildRevisions(today),
    focusLog: buildFocusLog(today, chapters),
    mockExams: buildMockExams(today),
    practiceLog: buildPracticeLog(today, chapters),
  };
}
