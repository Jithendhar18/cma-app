import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import { useNow } from '@/hooks/useTimerEngine';
import { formatClock } from '@/lib/timeFormat';
import { elapsedMs, phaseDurationMs, useTimerStore } from '@/stores/timerStore';
import { useStudyStore } from '@/stores/studyStore';

/** Floating status pill so a running timer stays visible on other pages. */
export function MiniTimer() {
  const timer = useTimerStore();
  const settings = useStudyStore((s) => s.settings);
  const now = useNow(1000, timer.status === 'running');
  if (timer.status === 'idle') return null;

  const total = phaseDurationMs(timer, settings);
  const elapsed = elapsedMs(timer, now);
  const shown = total === null ? elapsed : total - elapsed;
  const label = timer.phase === 'focus' ? 'Focus' : 'Break';

  return (
    <div className="fixed bottom-20 right-4 z-40 flex items-center gap-1 rounded-full border bg-surface-elevated py-1 pl-4 pr-1 shadow-card md:bottom-6 md:right-6">
      <Link to="/timer" className="flex items-baseline gap-2" aria-label="Open focus timer">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</span>
        <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{formatClock(shown)}</span>
      </Link>
      <button
        type="button"
        onClick={() => (timer.status === 'running' ? timer.pause() : timer.start())}
        aria-label={timer.status === 'running' ? 'Pause timer' : 'Resume timer'}
        className="flex size-9 items-center justify-center rounded-full bg-violet-600 text-white"
      >
        {timer.status === 'running' ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
    </div>
  );
}
