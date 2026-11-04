import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';

/** Points the timer at a planned session and opens it. Never starts counting until the user presses Start. */
export function useStartSession() {
  const navigate = useNavigate();
  return useCallback(
    (sessionId: string) => {
      const session = useStudyStore.getState().sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const timer = useTimerStore.getState();
      if (timer.status === 'idle') timer.setTarget(session.subjectId, session.chapterId, session.id);
      navigate('/timer');
    },
    [navigate],
  );
}
