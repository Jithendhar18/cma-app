import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { formatLongDate } from '@/lib/dates';
import type { EntityRow, Table } from '@/lib/sync/types';
import { useSync } from './syncContext';

const LABEL: Record<Table, string> = {
  planner_sessions: 'Planned session', chapter_progress: 'Chapter progress', revisions: 'Revision', study_sessions: 'Focus time', practice_records: 'Practice', mock_tests: 'Mock test',
  profiles: 'Your name', user_settings: 'Your settings', student_enrollments: 'Your exam dates',
};

/** A short, human line for a row (never raw JSON, never ids). */
function summary(table: Table, row: EntityRow | null): string {
  if (!row) return 'nothing (it was removed)';
  const text = (k: string) => (row[k] === null || row[k] === undefined ? '' : String(row[k]));
  switch (table) {
    case 'study_sessions': return `${text('minutes')} min on ${text('local_date')}${text('notes') ? ` — ${text('notes')}` : ''}`;
    case 'planner_sessions': return `${text('planned_date')} ${text('start_time')}, ${text('duration_minutes')} min, ${text('status')}${text('notes') ? ` — ${text('notes')}` : ''}`;
    case 'chapter_progress': return `${text('status').replace('_', ' ')}, confidence ${text('confidence')}${text('notes') ? ` — ${text('notes')}` : ''}`;
    case 'revisions': return `due ${text('due_date')}${text('completed_on') ? `, done ${text('completed_on')}` : ''}${text('cancelled_on') ? ', cancelled' : ''}`;
    case 'practice_records': return `${text('correct')}/${text('questions')} on ${text('local_date')}`;
    case 'profiles': return text('display_name');
    case 'user_settings': return `${text('daily_target_hours')} h daily, ${text('weekly_target_hours')} h weekly, ${text('study_start_time')}–${text('study_end_time')}, focus ${text('pomodoro_focus_minutes')} min, theme ${text('theme')}`;
    case 'student_enrollments': return `exam ${text('exam_date_override') || 'official date'}, final revision ${text('final_revision_date') || 'not set'}`;
    case 'mock_tests': return `${text('name')}: ${text('score')}/${text('max_score')} on ${text('taken_on')}`;
  }
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sync = useSync();
  const { status, conflicts, deadLetters } = sync;
  const headline =
    status.phase === 'paused' ? (status.message ?? 'Saving is paused.')
    : status.phase === 'offline' ? `You are offline. ${status.pending} change${status.pending === 1 ? ' is' : 's are'} kept on this device and will be sent when you reconnect.`
    : status.phase === 'attention' && status.message ? status.message
    : status.pending > 0 ? `${status.pending} change${status.pending === 1 ? ' is' : 's are'} waiting to be saved.`
    : 'Everything is saved to your account.';

  return (
    <Sheet open={open} onClose={onClose} title="Sync" description={status.lastSyncedAt ? `Last synced ${formatLongDate(status.lastSyncedAt.slice(0, 10))}` : 'Not synced yet in this session.'} side="right"
      footer={<><Button onClick={() => download('cma-sync-report.json', sync.exportDiagnostics())}>Export report</Button><Button variant="primary" onClick={sync.retry}>Sync now</Button></>}>
      <div className="space-y-5 text-[13px]">
        <p className="text-ink" role="status">{headline}</p>

        {(() => {
          const d = sync.diagnostics();
          if (!d) return null;
          return (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium text-ink">Details for troubleshooting</summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-ink-3">Waiting to be saved</dt><dd>{d.queued}</dd>
                <dt className="text-ink-3">Saved this session</dt><dd>{d.applied}</dd>
                <dt className="text-ink-3">Retried</dt><dd>{d.retried}</dd>
                <dt className="text-ink-3">Refused</dt><dd>{d.rejected}</dd>
                <dt className="text-ink-3">Overridden by newer data</dt><dd>{d.conflictsResolved}</dd>
                <dt className="text-ink-3">Requests this session</dt><dd>{d.requests}</dd>
                <dt className="text-ink-3">Last batch</dt><dd>{d.lastBatch ? `${d.lastBatch.ops} changes, ${d.lastBatch.requests} request${d.lastBatch.requests === 1 ? '' : 's'}, ${d.lastBatch.ms} ms` : 'none yet'}</dd>
              </dl>
            </details>
          );
        })()}

        {conflicts.length > 0 && (
          <section aria-label="Changes overridden by newer data">
            <h3 className="mb-2 font-semibold text-ink">Overridden by newer data</h3>
            <p className="mb-2 text-ink-3">These were changed on another device before this one could save them. The newer version was kept.</p>
            <ul className="space-y-2">
              {conflicts.map((c) => (
                <li key={c.id} className="rounded-lg border p-2.5">
                  <p className="font-medium text-ink">{LABEL[c.table]}</p>
                  <p className="text-ink-3">{c.note}</p>
                  <p className="mt-1 text-ink-2"><span className="text-ink-3">Yours:</span> {summary(c.table, c.mine)}</p>
                  <p className="text-ink-2"><span className="text-ink-3">Kept:</span> {summary(c.table, c.theirs)}</p>
                  <Button size="sm" className="mt-2" onClick={() => sync.dismissConflict(c.id)}>Dismiss</Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {deadLetters.length > 0 && (
          <section aria-label="Changes that could not be saved">
            <h3 className="mb-2 font-semibold text-ink">Could not be saved</h3>
            <p className="mb-2 text-ink-3">The server refused these changes. They are kept here so nothing is lost silently.</p>
            <ul className="space-y-2">
              {deadLetters.map((d) => (
                <li key={d.id} className="rounded-lg border p-2.5">
                  <p className="font-medium text-ink">{LABEL[d.op.table]}</p>
                  <p className="text-ink-3">{d.reason}</p>
                  <p className="mt-1 text-ink-2">{summary(d.op.table, d.op.row ?? null)}</p>
                  <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => sync.retryDeadLetter(d.id)}>Try again</Button><Button size="sm" onClick={() => sync.discardDeadLetter(d.id)}>Discard</Button></div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
