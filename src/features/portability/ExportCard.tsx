import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/authContext';
import { Notice } from '@/features/auth/components/Notice';
import { downloadJson, exportAccountData, exportFileName, ExportError, serializeExport } from '@/lib/portability/accountExport';

type State = { s: 'idle' } | { s: 'working' } | { s: 'done'; counts: Record<string, number> } | { s: 'error'; message: string };

const MESSAGE: Record<ExportError['kind'], string> = {
  network: 'Could not reach the server, so nothing was downloaded. Check your connection and try again.',
  'signed-out': 'Your session has ended, so nothing was downloaded. Sign in again and retry.',
  failed: 'Something went wrong while collecting your data, so nothing was downloaded. Try again.',
};

/** Downloads everything the account owns as one JSON file. Read-only: it changes nothing in the account or on this device. */
export function ExportCard() {
  const { client, state } = useAuth();
  const [st, setSt] = useState<State>({ s: 'idle' });
  if (state.status !== 'signed-in') return null;
  const userId = state.user.id;

  async function run() {
    if (!client) return;
    setSt({ s: 'working' });
    try {
      const doc = await exportAccountData(client, userId);
      downloadJson(exportFileName(doc), serializeExport(doc));
      setSt({ s: 'done', counts: doc.counts });
    } catch (error) {
      setSt({ s: 'error', message: error instanceof ExportError ? MESSAGE[error.kind] : MESSAGE.failed });
    }
  }

  return (
    <Card>
      <CardHeader title="Export your account data" description="A JSON file with your name, settings, enrolments and every study record, for all your enrolments." />
      <p className="mb-3 text-[13px] text-ink-2">The file has no password or sign-in tokens. It is only your own data. Exporting changes nothing.</p>
      <Button onClick={() => void run()} disabled={st.s === 'working' || !client} icon={<Download className="size-4" aria-hidden />}>{st.s === 'working' ? 'Collecting your data…' : 'Download my data'}</Button>
      <div className="mt-3" aria-live="polite">
        {st.s === 'done' && (
          <Notice tone="success">
            <p className="font-medium">Your data was downloaded.</p>
            <p>{st.counts.enrollments} enrolment{st.counts.enrollments === 1 ? '' : 's'}, {st.counts.study_sessions} focus records, {st.counts.planner_sessions} planned sessions, {st.counts.revisions} revisions, {st.counts.practice_records} practice records, {st.counts.mock_tests} mock tests, {st.counts.chapter_progress} chapters with progress.</p>
          </Notice>
        )}
        {st.s === 'error' && <Notice tone="error">{st.message}</Notice>}
      </div>
    </Card>
  );
}
