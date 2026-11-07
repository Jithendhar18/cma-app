import { CHAPTER_SEEDS, SUBJECTS } from '@/data/subjects';
import { addDaysISO } from '@/lib/dates';
import type {
  Chapter,
  FocusRecord,
  MockExam,
  PracticeRecord,
  Priority,
  RevisionNumber,
  RevisionTask,
  Settings,
  StudyDataSnapshot,
  StudySession,
} from '@/types/study';

const SAMPLE_EXAM_DATE = '2026-12-18';
const SAMPLE_FINAL_REVISION = '2026-12-05';
const DONE = ['completed', 'revision_due', 'exam_ready'];

export interface RevisionSeed {
  chapterId: string;
  revisionNumber: RevisionNumber;
  dueOffset: number;
  completedOffset: number | null;
  priority: Priority;
}

/** Offsets are days relative to the anchor date. completedOffset null means still pending. */
export const LEGACY_REVISION_SEEDS: RevisionSeed[] = [
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

/** Earlier revisions for chapters that already had a later one, so each chapter's history has no gaps. */
const EXTRA_REVISION_SEEDS: RevisionSeed[] = [
  { chapterId: 'p6-2', revisionNumber: 1, dueOffset: -9, completedOffset: -9, priority: 'medium' },
  { chapterId: 'p8-1', revisionNumber: 1, dueOffset: -24, completedOffset: -24, priority: 'high' },
  { chapterId: 'p7-2', revisionNumber: 1, dueOffset: -7, completedOffset: -7, priority: 'medium' },
  { chapterId: 'p11-1', revisionNumber: 1, dueOffset: -29, completedOffset: -29, priority: 'low' },
  { chapterId: 'p11-1', revisionNumber: 2, dueOffset: -22, completedOffset: -18, priority: 'low' },
];

export const REVISION_SEEDS: RevisionSeed[] = [...LEGACY_REVISION_SEEDS, ...EXTRA_REVISION_SEEDS];

export const CHAPTER_NOTES: Record<string, string> = {
  'p6-3': 'Practise the direct-method operating cash flow schedule. Revisit Ind AS 7 examples before the mock.',
  'p5-4': 'Focus on dishonour and presentment rules; create a one-page summary of liabilities.',
  'p8-3': 'Idle time and overtime premium are frequent MCQ traps. Re-solve the 2023 question set.',
};

/** Minutes studied for the most recent days (index 0 = today). Older days are generated. */
const RECENT_MINUTES = [275, 410, 365, 440, 300, 0, 390, 420, 480, 355, 210, 400, 445, 380];
export const HISTORY_DAYS = 90;
const TODAY_SESSION_MINUTES = 90;

export function minutesForDay(daysAgo: number): number {
  if (daysAgo < RECENT_MINUTES.length) return RECENT_MINUTES[daysAgo];
  if (daysAgo % 9 === 0) return 0;
  // Deterministic pseudo-variation between ~3h and ~8h, trending upward toward today.
  const wobble = ((daysAgo * 37) % 23) / 22;
  const trend = 1 - daysAgo / (HISTORY_DAYS * 1.6);
  return Math.round(((180 + wobble * 270) * trend) / 5) * 5;
}

interface Plan {
  id: string;
  subjectId: string;
  status: Chapter['status'];
  weight: number;
  questions: number;
  accuracy: number;
  /** Most recent day (days ago) with study time, on or after the sample's "days since studied". */
  lastDay: number | null;
}

function buildPlans(): Plan[] {
  return SUBJECTS.flatMap((subject) =>
    (CHAPTER_SEEDS[subject.id] ?? []).map(([, , status, , actualHours, questions, accuracy, daysAgo], index) => {
      let lastDay: number | null = null;
      if (daysAgo !== null && status !== 'not_started') {
        lastDay = daysAgo;
        while (lastDay < HISTORY_DAYS && minutesForDay(lastDay) <= 0) lastDay += 1;
      }
      return { id: `${subject.id}-${index + 1}`, subjectId: subject.id, status, weight: Math.max(1, actualHours), questions, accuracy, lastDay };
    }),
  );
}

function iso(today: string, daysAgo: number) {
  return addDaysISO(today, -daysAgo);
}

/**
 * Focus history is the source of truth. Each chapter only receives records on or before its last
 * studied day, and on that exact day it is guaranteed at least one record.
 */
function buildFocusLog(today: string, plans: Plan[]): FocusRecord[] {
  const records: FocusRecord[] = [];
  const studied = plans.filter((p) => p.lastDay !== null);

  for (let day = 0; day < HISTORY_DAYS; day += 1) {
    let remaining = minutesForDay(day);
    if (remaining <= 0) continue;
    const date = iso(today, day);

    if (day === 0) {
      records.push({
        id: 'f-today-s1', date, subjectId: 'p6', chapterId: 'p6-3', minutes: TODAY_SESSION_MINUTES,
        mode: 'planner', notes: '', sessionId: 's-1', demo: true,
      });
      remaining -= TODAY_SESSION_MINUTES;
    }

    const forced = studied.filter((p) => p.lastDay === day);
    // Today has no chapter whose last day is 0, so chapters studied yesterday may also be studied today.
    const eligible = studied.filter((p) => (p.lastDay as number) <= Math.max(day, 1));
    if (eligible.length === 0 || remaining <= 0) continue;

    const count = Math.max(forced.length, Math.ceil(remaining / 100));
    const base = Math.max(5, Math.floor(remaining / count / 5) * 5);
    const totalWeight = eligible.reduce((s, p) => s + p.weight, 0);

    for (let i = 0; i < count; i += 1) {
      const minutes = i === count - 1 ? remaining - base * (count - 1) : base;
      if (minutes <= 0) break;
      let plan = forced[i];
      if (!plan) {
        let pick = (day * 131 + i * 17 + 7) % Math.round(totalWeight);
        plan = eligible.find((p) => (pick -= p.weight) < 0) ?? eligible[0];
      }
      records.push({
        id: `f-${day}-${i}`, date, subjectId: plan.subjectId, chapterId: plan.id, minutes,
        mode: i % 3 === 2 ? 'stopwatch' : 'pomodoro', notes: '', sessionId: null, demo: true,
      });
    }
  }
  return records;
}

/** Practice records add up exactly to each chapter's question and correct-answer totals. */
function buildPracticeLog(today: string, plans: Plan[]): PracticeRecord[] {
  const records: PracticeRecord[] = [];
  for (const plan of plans) {
    if (plan.questions <= 0 || plan.lastDay === null) continue;
    const total = plan.questions;
    const correctTotal = Math.round((total * plan.accuracy) / 100);
    const parts = Math.min(5, total);
    let cumQ = 0;
    let cumC = 0;
    for (let i = 0; i < parts; i += 1) {
      const q = Math.floor(total / parts) + (i < total % parts ? 1 : 0);
      cumQ += q;
      const c = Math.floor((correctTotal * cumQ) / total) - cumC;
      cumC += c;
      const day = Math.min(HISTORY_DAYS - 1, plan.lastDay + [0, 4, 9, 17, 26][i]);
      records.push({ id: `pr-${plan.id}-${i}`, date: iso(today, day), chapterId: plan.id, subjectId: plan.subjectId, questions: q, correct: c, demo: true });
    }
  }
  return records;
}

function buildChapters(today: string, plans: Plan[], focus: FocusRecord[], practice: PracticeRecord[]): Chapter[] {
  const minutesBy = new Map<string, number>();
  const lastBy = new Map<string, string>();
  const note = (id: string, date: string) => {
    if (!lastBy.has(id) || date > (lastBy.get(id) as string)) lastBy.set(id, date);
  };
  focus.forEach((r) => {
    minutesBy.set(r.chapterId, (minutesBy.get(r.chapterId) ?? 0) + r.minutes);
    note(r.chapterId, r.date);
  });
  const qBy = new Map<string, { q: number; c: number }>();
  practice.forEach((r) => {
    const cur = qBy.get(r.chapterId) ?? { q: 0, c: 0 };
    qBy.set(r.chapterId, { q: cur.q + r.questions, c: cur.c + r.correct });
    note(r.chapterId, r.date);
  });
  const planById = new Map(plans.map((p) => [p.id, p]));

  return SUBJECTS.flatMap((subject) =>
    (CHAPTER_SEEDS[subject.id] ?? []).map(([title, estimatedHours, status, confidence], index) => {
      const id = `${subject.id}-${index + 1}`;
      const plan = planById.get(id) as Plan;
      return {
        id,
        subjectId: subject.id,
        order: index + 1,
        title,
        status,
        estimatedHours,
        actualHours: (minutesBy.get(id) ?? 0) / 60,
        confidence,
        questionsPracticed: qBy.get(id)?.q ?? 0,
        correctAnswers: qBy.get(id)?.c ?? 0,
        lastStudied: lastBy.get(id) ?? null,
        completedOn: DONE.includes(status) && plan.lastDay !== null ? iso(today, plan.lastDay) : null,
        demo: true,
        notes: CHAPTER_NOTES[id] ?? '',
      };
    }),
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
    demo: true,
  }));
}

function buildSessions(today: string): StudySession[] {
  const row = (
    id: string, offset: number, subjectId: string, chapterId: string, startTime: string,
    durationMinutes: number, status: StudySession['status'], priority: Priority,
  ): StudySession => ({ id, date: addDaysISO(today, offset), subjectId, chapterId, startTime, durationMinutes, status, priority, notes: '', demo: true });
  return [
    row('s-1', 0, 'p6', 'p6-3', '18:00', 90, 'completed', 'high'),
    row('s-2', 0, 'p5', 'p5-3', '19:30', 60, 'in_progress', 'high'),
    row('s-3', 0, 'p8', 'p8-3', '20:30', 90, 'upcoming', 'medium'),
    row('s-4', 0, 'p7', 'p7-3', '22:00', 60, 'upcoming', 'medium'),
    row('s-5', -1, 'p9', 'p9-3', '18:00', 60, 'missed', 'medium'),
    row('s-6', 1, 'p12', 'p12-3', '07:00', 120, 'upcoming', 'high'),
    row('s-7', 1, 'p10', 'p10-2', '10:00', 90, 'upcoming', 'medium'),
    row('s-8', 2, 'p11', 'p11-3', '08:00', 120, 'upcoming', 'high'),
  ];
}

/** Sample mock scores (demo data). */
function buildMockExams(today: string): MockExam[] {
  const m = (id: string, offset: number, subjectId: string, name: string, score: number): MockExam => ({
    id, date: addDaysISO(today, offset), subjectId, name, score, maxScore: 100, demo: true,
  });
  return [
    m('m-1', -42, 'p6', 'Mock Test 1', 48), m('m-2', -35, 'p8', 'Mock Test 1', 55), m('m-3', -28, 'p5', 'Mock Test 1', 52),
    m('m-4', -21, 'p12', 'Mock Test 1', 46), m('m-5', -14, 'p6', 'Mock Test 2', 58), m('m-6', -9, 'p7', 'Mock Test 1', 61),
    m('m-7', -4, 'p8', 'Mock Test 2', 64),
  ];
}

export function buildSettings(): Settings {
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

/** Builds a fresh demo snapshot anchored to `today`. Pure: same input, same output, no storage access. */
export function createSeedData(today: string): StudyDataSnapshot {
  const plans = buildPlans();
  const focusLog = buildFocusLog(today, plans);
  const practiceLog = buildPracticeLog(today, plans);
  return {
    settings: buildSettings(),
    chapters: buildChapters(today, plans, focusLog, practiceLog),
    sessions: buildSessions(today),
    revisions: buildRevisions(today),
    focusLog,
    mockExams: buildMockExams(today),
    practiceLog,
    meta: { seedAnchor: today },
  };
}
