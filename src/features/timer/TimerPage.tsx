import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Pause, Play, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { fieldClass, labelClass } from '@/components/ui/field';
import { SUBJECTS } from '@/data/subjects';
import { useNow } from '@/hooks/useTimerEngine';
import { useStudyLog } from '@/hooks/useStudyData';
import { cn } from '@/lib/cn';
import { todayMinutes } from '@/lib/analytics';
import { formatShortDate, todayISO } from '@/lib/dates';
import { formatMinutes } from '@/lib/format';
import { formatClock } from '@/lib/timeFormat';
import { useStudyStore } from '@/stores/studyStore';
import { elapsedMs, phaseDurationMs, useTimerStore, type TimerMode } from '@/stores/timerStore';

const RING = 300;
const STROKE = 10;

export default function TimerPage() {
  const timer = useTimerStore();
  const settings = useStudyStore((s) => s.settings);
  const chapters = useStudyStore((s) => s.chapters);
  const focusLog = useStudyStore((s) => s.focusLog);
  const removeRecord = useStudyStore((s) => s.removeFocusRecord);
  const studyLog = useStudyLog();
  const now = useNow(250, timer.status === 'running');

  const total = phaseDurationMs(timer, settings);
  const elapsed = elapsedMs(timer, now);
  const isBreak = timer.phase !== 'focus';
  const display = total === null ? elapsed : Math.max(0, total - elapsed);
  const progress = total === null ? (elapsed % 3_600_000) / 3_600_000 : Math.min(1, elapsed / total);
  const locked = timer.status !== 'idle' && !isBreak;
  const subjectChapters = chapters.filter((c) => c.subjectId === timer.subjectId).sort((a, b) => a.order - b.order);
  const todayTotal = todayMinutes(studyLog, todayISO());
  const history = [...focusLog].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 8);

  const radius = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const phaseLabel = timer.phase === 'focus' ? (timer.mode === 'pomodoro' ? 'Focus' : 'Stopwatch') : timer.phase === 'short_break' ? 'Short break' : 'Long break';
  const ringColor = isBreak ? '#10B981' : '#8B5CF6';
  const cyclePos = timer.completedFocusCount % settings.longBreakEvery;

  const onSubject = (subjectId: string) => {
    const first = chapters.filter((c) => c.subjectId === subjectId).sort((a, b) => a.order - b.order)[0];
    timer.setTarget(subjectId, first?.id ?? '');
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[980px] flex-col gap-6 px-4 pb-10 pt-4 md:min-h-0 md:px-0 md:pt-0">
      <div className="flex items-center justify-between md:hidden">
        <Link to="/" aria-label="Back to dashboard" className="flex size-10 items-center justify-center rounded-lg text-ink-2 hover:text-ink">
          <ArrowLeft className="size-5" />
        </Link>
        <span className="text-[13px] font-medium text-ink-2">Today {formatMinutes(todayTotal)}</span>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col items-center !py-8">
          <div role="radiogroup" aria-label="Timer mode" className="mb-6 flex rounded-lg border bg-canvas p-0.5">
            {(['pomodoro', 'stopwatch'] as TimerMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={timer.mode === m}
                disabled={timer.status !== 'idle'}
                onClick={() => timer.setMode(m)}
                className={cn('h-8 rounded-md px-4 text-[12px] font-medium capitalize transition-colors disabled:cursor-not-allowed', timer.mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="relative w-full max-w-[300px]" style={{ aspectRatio: '1' }}>
            <svg viewBox={`0 0 ${RING} ${RING}`} className="size-full -rotate-90" aria-hidden>
              <circle cx={RING / 2} cy={RING / 2} r={radius} fill="none" strokeWidth={STROKE} className="stroke-ink/[0.07]" />
              <circle
                cx={RING / 2}
                cy={RING / 2}
                r={radius}
                fill="none"
                stroke={ringColor}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                style={{ transition: 'stroke-dashoffset 0.3s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Badge tone={isBreak ? 'emerald' : 'violet'} dot>{phaseLabel}</Badge>
              <p role="timer" aria-live="off" className="mt-3 font-mono text-[52px] font-semibold leading-none tabular-nums tracking-tight text-ink">{formatClock(display)}</p>
              <p className="mt-2 text-[12px] text-ink-3">
                {timer.status === 'paused' ? 'Paused' : timer.status === 'running' ? (isBreak ? 'Rest up' : 'Stay with it') : 'Ready'}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {timer.status === 'running' ? (
              <Button variant="primary" className="h-12 min-w-32 text-[14px]" onClick={timer.pause} icon={<Pause className="size-5" />}>Pause</Button>
            ) : (
              <Button variant="primary" className="h-12 min-w-32 text-[14px]" onClick={timer.start} disabled={!timer.chapterId} icon={<Play className="size-5" />}>
                {timer.status === 'paused' ? 'Resume' : isBreak ? 'Start break' : 'Start'}
              </Button>
            )}
            {isBreak ? (
              <Button className="h-12" onClick={timer.skipBreak} icon={<SkipForward className="size-4" />}>Skip break</Button>
            ) : (
              <>
                <Button className="h-12" onClick={timer.reset} disabled={timer.status === 'idle'} icon={<RotateCcw className="size-4" />} aria-label="Reset timer, discarding this block">Reset</Button>
                <Button className="h-12" onClick={timer.finish} disabled={timer.status === 'idle' || elapsed < 60_000} icon={<Check className="size-4" />} aria-label="Finish and log focused time">Finish</Button>
              </>
            )}
          </div>

          {timer.mode === 'pomodoro' && (
            <div className="mt-6 flex items-center gap-2" aria-label={`${cyclePos} of ${settings.longBreakEvery} focus sessions before long break`}>
              {Array.from({ length: settings.longBreakEvery }, (_, i) => (
                <span key={i} className={cn('size-2 rounded-full', i < cyclePos ? 'bg-violet-500' : 'bg-ink/15')} />
              ))}
              <span className="ml-2 text-[12px] text-ink-3">Long break after {settings.longBreakEvery} sessions</span>
            </div>
          )}
          <p className="mt-3 text-[12px] text-ink-3">Only focused time is logged. Breaks and paused time are excluded.</p>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Session" description={locked ? 'Locked while a focus block is running.' : 'Choose what you are studying.'} />
            <div className="space-y-4">
              <div>
                <label htmlFor="t-subject" className={labelClass}>Subject</label>
                <select id="t-subject" className={fieldClass} value={timer.subjectId} disabled={locked} onChange={(e) => onSubject(e.target.value)}>
                  {SUBJECTS.map((s) => <option key={s.id} value={s.id}>Paper {s.paperNumber} · {s.shortName}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="t-chapter" className={labelClass}>Chapter</label>
                <select id="t-chapter" className={fieldClass} value={timer.chapterId} disabled={locked} onChange={(e) => timer.setTarget(timer.subjectId, e.target.value)}>
                  {subjectChapters.map((c) => <option key={c.id} value={c.id}>{c.order}. {c.title}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="t-notes" className={labelClass}>Session notes</label>
                <textarea id="t-notes" rows={3} className={cn(fieldClass, 'h-auto py-2')} value={timer.notes} onChange={(e) => timer.setNotes(e.target.value)} placeholder="What did you cover? Saved when the block is logged." />
              </div>
            </div>
          </Card>
          <Card className="hidden md:block">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Today</p>
            <p className="mt-1 text-[24px] font-semibold text-ink">{formatMinutes(todayTotal)}</p>
            <p className="text-[12px] text-ink-3">of {formatMinutes(settings.dailyTargetHours * 60)} target · {settings.pomodoroFocusMinutes}/{settings.shortBreakMinutes}/{settings.longBreakMinutes} min cycle</p>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Session history" description="Most recent focus blocks, including planner completions." />
        {history.length === 0 ? (
          <p className="text-[13px] text-ink-2">No sessions logged yet. Complete a block to see it here.</p>
        ) : (
          <ul className="divide-y">
            {history.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{chapters.find((c) => c.id === r.chapterId)?.title}</p>
                  <p className="truncate text-[12px] text-ink-3">{formatShortDate(r.date)} · {r.mode}{r.notes ? ` · ${r.notes}` : ''}</p>
                </div>
                <span className="text-[13px] font-semibold text-ink">{formatMinutes(r.minutes)}</span>
                <Button size="icon" variant="ghost" aria-label="Remove this log entry" onClick={() => removeRecord(r.id)} icon={<Trash2 className="size-4" />} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
