import { BUNDLED_CURRICULUM } from '@/lib/curriculum/bundled';
import { studyStreak, subjectStats, totalMinutes } from '@/lib/analytics';
import type { Chapter, FocusRecord, PracticeRecord, RevisionTask, StudyLog, Subject } from '@/types/study';

export interface AchievementInput {
  focusLog: FocusRecord[];
  studyLog: StudyLog;
  chapters: Chapter[];
  revisions: RevisionTask[];
  practiceLog: PracticeRecord[];
  today: string;
  /** The subjects of the curriculum in effect. Defaults to the bundled sample (local mode, and the original unit tests). */
  subjects?: Subject[];
}

export interface Badge {
  id: string;
  title: string;
  description: string;
  current: number;
  target: number;
}

export interface Progress {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  badges: Badge[];
  streak: number;
  longestStreak: number;
}

/** XP needed to go from level n to n+1. */
const xpForLevel = (level: number) => 200 + (level - 1) * 100;

export function longestStreak(log: StudyLog): number {
  const days = Object.keys(log).filter((d) => log[d] > 0).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    if (prev) {
      const gap = Math.round((new Date(d).getTime() - new Date(prev).getTime()) / 86_400_000);
      run = gap === 1 ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function computeProgress(input: AchievementInput): Progress {
  const { focusLog, studyLog, chapters, revisions, practiceLog, today } = input;
  const subjects = input.subjects ?? BUNDLED_CURRICULUM.subjects;
  const hours = totalMinutes(studyLog) / 60;
  const revisionsDone = revisions.filter((r) => r.completedOn).length;
  const questions = practiceLog.reduce((s, p) => s + p.questions, 0);
  const doneChapters = chapters.filter((c) => ['completed', 'revision_due', 'exam_ready'].includes(c.status)).length;
  const subjectsDone = subjects.filter((s) => {
    const st = subjectStats(s.id, chapters, revisions);
    return st.total > 0 && st.done === st.total;
  }).length;
  const streak = studyStreak(studyLog, today);
  const best = longestStreak(studyLog);

  // 10 XP per focused hour, 40 per chapter completed, 15 per revision, 1 per 5 questions.
  let xp = Math.round(hours * 10 + doneChapters * 40 + revisionsDone * 15 + questions / 5);

  const badges: Badge[] = [
    { id: 'first-focus', title: 'First Focus Session', description: 'Log your first focus block.', current: focusLog.length, target: 1 },
    { id: 'ten-hours', title: '10 Study Hours', description: 'Reach 10 hours of focused study.', current: hours, target: 10 },
    { id: 'hundred-hours', title: '100 Study Hours', description: 'Reach 100 hours of focused study.', current: hours, target: 100 },
    { id: 'streak-7', title: '7-Day Streak', description: 'Study on seven consecutive days.', current: best, target: 7 },
    { id: 'streak-30', title: '30-Day Streak', description: 'Study on thirty consecutive days.', current: best, target: 30 },
    { id: 'first-subject', title: 'First Subject Completed', description: 'Finish every chapter in one paper.', current: subjectsDone, target: 1 },
    { id: 'rev-100', title: '100 Revisions', description: 'Complete one hundred revisions.', current: revisionsDone, target: 100 },
    { id: 'q-100', title: '100 Practice Questions', description: 'Practise one hundred questions.', current: questions, target: 100 },
    { id: 'q-1000', title: '1,000 Practice Questions', description: 'Practise one thousand questions.', current: questions, target: 1000 },
  ];
  xp += badges.filter((b) => b.current >= b.target).length * 50;

  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return { xp, level, xpIntoLevel: remaining, xpForLevel: xpForLevel(level), badges, streak, longestStreak: best };
}
