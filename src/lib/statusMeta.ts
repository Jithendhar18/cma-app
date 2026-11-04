import type { ChapterStatus, Priority, SessionStatus } from '@/types/study';

export type Tone = 'neutral' | 'blue' | 'violet' | 'emerald' | 'amber' | 'red';

export const CHAPTER_STATUS_META: Record<ChapterStatus, { label: string; tone: Tone }> = {
  not_started: { label: 'Not Started', tone: 'neutral' },
  learning: { label: 'Learning', tone: 'blue' },
  practising: { label: 'Practising', tone: 'violet' },
  completed: { label: 'Completed', tone: 'emerald' },
  revision_due: { label: 'Revision Due', tone: 'amber' },
  exam_ready: { label: 'Exam Ready', tone: 'emerald' },
};

export const CHAPTER_STATUS_OPTIONS = (Object.keys(CHAPTER_STATUS_META) as ChapterStatus[]).map((value) => ({
  value,
  label: CHAPTER_STATUS_META[value].label,
}));

export const SESSION_STATUS_META: Record<SessionStatus, { label: string; tone: Tone }> = {
  upcoming: { label: 'Upcoming', tone: 'blue' },
  in_progress: { label: 'In Progress', tone: 'violet' },
  completed: { label: 'Completed', tone: 'emerald' },
  missed: { label: 'Missed', tone: 'red' },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: Tone }> = {
  high: { label: 'High', tone: 'red' },
  medium: { label: 'Medium', tone: 'amber' },
  low: { label: 'Low', tone: 'neutral' },
};

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-2',
  blue: 'text-blue-600 dark:text-blue-400',
  violet: 'text-violet-600 dark:text-violet-400',
  emerald: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
};

export const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06]',
  blue: 'bg-blue-500/12',
  violet: 'bg-violet-500/12',
  emerald: 'bg-emerald-500/12',
  amber: 'bg-amber-500/14',
  red: 'bg-red-500/12',
};

export const TONE_SOLID: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};
