import { buildExportEnvelope, parseExportExtras, type ExportEnvelope } from '@/lib/exportData';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';

/** Everything worth backing up: study data, timer selection and UI preferences. */
export function buildExport(): ExportEnvelope {
  const s = useStudyStore.getState();
  const t = useTimerStore.getState();
  return buildExportEnvelope(
    { settings: s.settings, chapters: s.chapters, sessions: s.sessions, revisions: s.revisions, focusLog: s.focusLog, mockExams: s.mockExams, practiceLog: s.practiceLog, meta: s.meta },
    { mode: t.mode, subjectId: t.subjectId, chapterId: t.chapterId, notes: t.notes, completedFocusCount: t.completedFocusCount },
    { sidebarCollapsed: useUiStore.getState().sidebarCollapsed },
  );
}

/** Applies the optional timer and UI sections of an import. Always leaves the timer idle. */
export function applyImportExtras(raw: unknown): void {
  const chapterIds = new Set(useStudyStore.getState().chapters.map((c) => c.id));
  const { timer, ui } = parseExportExtras(raw, chapterIds);
  const store = useTimerStore.getState();
  store.reset();
  if (timer) {
    useTimerStore.setState({ ...timer, status: 'idle', phase: 'focus', runStartedAt: null, accumulatedMs: 0, sessionKey: null, focusMsByDate: {}, plannedSessionId: null });
  }
  if (ui) useUiStore.setState({ sidebarCollapsed: ui.sidebarCollapsed });
}
