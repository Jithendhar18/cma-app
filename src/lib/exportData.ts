import type { StudyDataSnapshot } from '@/types/study';

export const EXPORT_VERSION = 3;

/**
 * Timer selection that is safe to move between devices. A running or paused block is deliberately
 * not exported: its timestamps are only meaningful on the device that started it, and importing
 * one elsewhere could log the same focused time twice.
 */
export interface TimerSelectionExport {
  mode: 'pomodoro' | 'stopwatch';
  subjectId: string;
  chapterId: string;
  notes: string;
  completedFocusCount: number;
}

export interface UiPrefsExport {
  sidebarCollapsed: boolean;
}

export interface ExportEnvelope extends StudyDataSnapshot {
  exportVersion: number;
  exportedAt: string;
  timer?: TimerSelectionExport;
  ui?: UiPrefsExport;
}

export function buildExportEnvelope(
  data: StudyDataSnapshot,
  timer: TimerSelectionExport,
  ui: UiPrefsExport,
  now: Date = new Date(),
): ExportEnvelope {
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    settings: data.settings,
    chapters: data.chapters,
    sessions: data.sessions,
    revisions: data.revisions,
    focusLog: data.focusLog,
    mockExams: data.mockExams,
    practiceLog: data.practiceLog,
    meta: data.meta,
    timer,
    ui,
  };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads the optional timer and UI sections. Anything malformed is ignored, never fatal. */
export function parseExportExtras(raw: unknown, chapterIds: Set<string>): { timer?: TimerSelectionExport; ui?: UiPrefsExport } {
  if (!isRec(raw)) return {};
  const out: { timer?: TimerSelectionExport; ui?: UiPrefsExport } = {};
  const t = raw.timer;
  if (
    isRec(t) &&
    (t.mode === 'pomodoro' || t.mode === 'stopwatch') &&
    typeof t.subjectId === 'string' &&
    typeof t.chapterId === 'string' &&
    chapterIds.has(t.chapterId) &&
    typeof t.notes === 'string' &&
    typeof t.completedFocusCount === 'number' &&
    Number.isInteger(t.completedFocusCount) &&
    t.completedFocusCount >= 0
  ) {
    out.timer = { mode: t.mode, subjectId: t.subjectId, chapterId: t.chapterId, notes: t.notes, completedFocusCount: t.completedFocusCount };
  }
  if (isRec(raw.ui) && typeof raw.ui.sidebarCollapsed === 'boolean') out.ui = { sidebarCollapsed: raw.ui.sidebarCollapsed };
  return out;
}
