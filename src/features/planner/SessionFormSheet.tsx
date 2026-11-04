import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { fieldClass, labelClass } from '@/components/ui/field';
import { Sheet } from '@/components/ui/Sheet';
import { SUBJECTS } from '@/data/subjects';
import { useStudyStore } from '@/stores/studyStore';
import type { Priority, StudySession } from '@/types/study';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing session to edit; omit to create. */
  session?: StudySession;
  defaultDate: string;
}

interface Draft {
  date: string;
  startTime: string;
  durationMinutes: string;
  subjectId: string;
  chapterId: string;
  priority: Priority;
  notes: string;
}

export function SessionFormSheet({ open, onClose, session, defaultDate }: Props) {
  const chapters = useStudyStore((s) => s.chapters);
  const addSession = useStudyStore((s) => s.addSession);
  const updateSession = useStudyStore((s) => s.updateSession);
  const deleteSession = useStudyStore((s) => s.deleteSession);

  const blank = (): Draft => ({
    date: defaultDate,
    startTime: '18:00',
    durationMinutes: '60',
    subjectId: SUBJECTS[0].id,
    chapterId: chapters.find((c) => c.subjectId === SUBJECTS[0].id)?.id ?? '',
    priority: 'medium',
    notes: '',
  });
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setDraft(
      session
        ? { date: session.date, startTime: session.startTime, durationMinutes: String(session.durationMinutes), subjectId: session.subjectId, chapterId: session.chapterId, priority: session.priority, notes: session.notes }
        : blank(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id, defaultDate]);

  const subjectChapters = chapters.filter((c) => c.subjectId === draft.subjectId).sort((a, b) => a.order - b.order);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const onSubject = (subjectId: string) =>
    setDraft((d) => ({ ...d, subjectId, chapterId: chapters.find((c) => c.subjectId === subjectId)?.id ?? '' }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const duration = Number(draft.durationMinutes);
    if (!draft.date) return setError('Choose a date.');
    if (!draft.startTime) return setError('Choose a start time.');
    if (!Number.isInteger(duration) || duration < 5 || duration > 600) return setError('Duration must be between 5 and 600 minutes.');
    if (!draft.chapterId) return setError('Choose a chapter.');
    const payload = { date: draft.date, startTime: draft.startTime, durationMinutes: duration, subjectId: draft.subjectId, chapterId: draft.chapterId, priority: draft.priority, notes: draft.notes.trim() };
    if (session) updateSession(session.id, payload);
    else addSession({ ...payload, status: 'upcoming' });
    onClose();
  };

  const endTime = (() => {
    const [h, m] = draft.startTime.split(':').map(Number);
    const total = h * 60 + m + (Number(draft.durationMinutes) || 0);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={session ? 'Edit session' : 'New study session'}
      description={`Ends at ${endTime}`}
      footer={
        <>
          {session && (
            <Button
              variant="ghost"
              className="mr-auto text-red-500"
              onClick={() => {
                deleteSession(session.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="session-form">{session ? 'Save changes' : 'Create session'}</Button>
        </>
      }
    >
      <form id="session-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="sf-date">Date</label>
            <input id="sf-date" type="date" className={fieldClass} value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sf-time">Start time</label>
            <input id="sf-time" type="time" className={fieldClass} value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="sf-subject">Subject</label>
          <select id="sf-subject" className={fieldClass} value={draft.subjectId} onChange={(e) => onSubject(e.target.value)}>
            {SUBJECTS.map((s) => <option key={s.id} value={s.id}>Paper {s.paperNumber} · {s.shortName}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="sf-chapter">Chapter</label>
          <select id="sf-chapter" className={fieldClass} value={draft.chapterId} onChange={(e) => set('chapterId', e.target.value)}>
            {subjectChapters.map((c) => <option key={c.id} value={c.id}>{c.order}. {c.title}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="sf-dur">Duration (minutes)</label>
            <input id="sf-dur" inputMode="numeric" className={fieldClass} value={draft.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sf-pri">Priority</label>
            <select id="sf-pri" className={fieldClass} value={draft.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="sf-notes">Notes</label>
          <textarea id="sf-notes" rows={3} className={`${fieldClass} h-auto py-2`} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
      </form>
    </Sheet>
  );
}
