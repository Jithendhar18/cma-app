import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { SUBJECTS } from '@/data/subjects';
import { ChaptersTab } from '@/features/subjects/ChaptersTab';
import { NotesTab } from '@/features/subjects/NotesTab';
import { OverviewTab } from '@/features/subjects/OverviewTab';
import { PracticeTab } from '@/features/subjects/PracticeTab';
import { RevisionHistoryTab } from '@/features/subjects/RevisionHistoryTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'practice', label: 'Practice' },
  { id: 'revisions', label: 'Revision History' },
  { id: 'notes', label: 'Notes' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function SubjectDetailPage() {
  const { subjectId } = useParams();
  const [params, setParams] = useSearchParams();
  const subject = SUBJECTS.find((s) => s.id === subjectId);
  if (!subject) return <Navigate to="/subjects" replace />;

  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as TabId;
  const focusChapter = params.get('chapter');

  return (
    <div className="space-y-6">
      <Link to="/subjects" className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" /> All subjects
      </Link>
      <PageHeader eyebrow={<span className="text-[12px] font-medium text-ink-3">Paper {subject.paperNumber} · {subject.group}</span>} title={subject.name} />
      <Tabs label="Subject sections" tabs={TABS.map((t) => ({ ...t }))} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} />
      {tab === 'overview' && <OverviewTab subject={subject} />}
      {tab === 'chapters' && <ChaptersTab subject={subject} focusChapterId={focusChapter} />}
      {tab === 'practice' && <PracticeTab subject={subject} />}
      {tab === 'revisions' && <RevisionHistoryTab subject={subject} />}
      {tab === 'notes' && <NotesTab subject={subject} />}
    </div>
  );
}
