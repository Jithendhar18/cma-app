import { Check, Pencil, Play, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SUBJECTS } from '@/data/subjects';
import { useStartSession } from '@/features/timer/useStartSession';
import { effectiveSessionStatus } from '@/lib/analytics';
import { formatTime12h, todayISO } from '@/lib/dates';
import { formatDuration } from '@/lib/format';
import { PRIORITY_META, SESSION_STATUS_META } from '@/lib/statusMeta';
import { useStudyStore } from '@/stores/studyStore';
import type { StudySession } from '@/types/study';

export function SessionRow({ session, onEdit, compact = false }: { session: StudySession; onEdit: (s: StudySession) => void; compact?: boolean }) {
  const chapter = useStudyStore((s) => s.chapters).find((c) => c.id === session.chapterId);
  const setStatus = useStudyStore((s) => s.setSessionStatus);
  const start = useStartSession();
  const status = effectiveSessionStatus(session, todayISO());
  const meta = SESSION_STATUS_META[status];
  const subject = SUBJECTS.find((s) => s.id === session.subjectId);
  const done = status === 'completed';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-canvas p-3">
      <div className="w-[72px] shrink-0 text-[12px] font-medium text-ink-2">{formatTime12h(session.startTime)}</div>
      <div className="min-w-0 flex-1 basis-40">
        <p className={`truncate text-[13px] font-medium ${done ? 'text-ink-2 line-through' : 'text-ink'}`}>{chapter?.title}</p>
        <p className="truncate text-[12px] text-ink-3">Paper {subject?.paperNumber} · {formatDuration(session.durationMinutes)}</p>
      </div>
      {!compact && <Badge tone={PRIORITY_META[session.priority].tone}>{PRIORITY_META[session.priority].label}</Badge>}
      <Badge tone={meta.tone} dot>{meta.label}</Badge>
      <div className="ml-auto flex items-center gap-1">
        {!done && status !== 'missed' && (
          <Button size="icon" variant="ghost" aria-label="Start session in timer" onClick={() => start(session.id)} icon={<Play className="size-4" />} />
        )}
        {done ? (
          <Button size="icon" variant="ghost" aria-label="Mark as not completed" onClick={() => setStatus(session.id, 'upcoming')} icon={<RotateCcw className="size-4" />} />
        ) : (
          <Button size="icon" variant="ghost" aria-label="Mark as completed" onClick={() => setStatus(session.id, 'completed')} icon={<Check className="size-4" />} />
        )}
        <Button size="icon" variant="ghost" aria-label="Edit session" onClick={() => onEdit(session)} icon={<Pencil className="size-4" />} />
      </div>
    </div>
  );
}
