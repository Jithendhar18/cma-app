import { useNavigate } from 'react-router-dom';
import { CalendarX, Play } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
import { effectiveSessionStatus } from '@/lib/analytics';
import { formatTime12h, todayISO } from '@/lib/dates';
import { formatDuration } from '@/lib/format';
import { SESSION_STATUS_META } from '@/lib/statusMeta';
import { useStartSession } from '@/features/timer/useStartSession';
import { useStudyStore } from '@/stores/studyStore';

export function TodaySchedule() {
  const { subjects: curriculumSubjects } = useCurriculum();
  const navigate = useNavigate();
  const startSession = useStartSession();
  const today = todayISO();
  const sessions = useStudyStore((s) => s.sessions);
  const chapters = useStudyStore((s) => s.chapters);
  const todays = sessions.filter((s) => s.date === today).sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <Card>
      <CardHeader
        title="Today's schedule"
        description={`${todays.length} session${todays.length === 1 ? '' : 's'} planned`}
        action={<Button size="sm" variant="ghost" onClick={() => navigate('/planner')}>Open planner</Button>}
      />
      {todays.length === 0 ? (
        <EmptyState icon={CalendarX} title="Nothing scheduled" description="Plan today's sessions to hit your daily target." action={<Button onClick={() => navigate('/planner')}>Plan a session</Button>} />
      ) : (
        <ul className="divide-y">
          {todays.map((session) => {
            const status = effectiveSessionStatus(session, today);
            const meta = SESSION_STATUS_META[status];
            const subject = curriculumSubjects.find((s) => s.id === session.subjectId);
            const chapter = chapters.find((c) => c.id === session.chapterId);
            return (
              <li key={session.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="w-[68px] shrink-0 text-[12px] text-ink-2">{formatTime12h(session.startTime)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{chapter?.title}</p>
                  <p className="truncate text-[12px] text-ink-3">
                    Paper {subject?.paperNumber} · {formatDuration(session.durationMinutes)}
                  </p>
                </div>
                <Badge tone={meta.tone} dot>{meta.label}</Badge>
                {(status === 'upcoming' || status === 'in_progress') && (
                  <Button size="sm" variant="secondary" icon={<Play className="size-3.5" />} onClick={() => startSession(session.id)} aria-label={`Start ${chapter?.title}`}>
                    <span className="hidden sm:inline">{status === 'in_progress' ? 'Resume' : 'Start'}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
