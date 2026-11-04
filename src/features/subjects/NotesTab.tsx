import { StickyNote } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { fieldClass, labelClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useStudyStore } from '@/stores/studyStore';
import type { Subject } from '@/types/study';

export function NotesTab({ subject }: { subject: Subject }) {
  const chapters = useStudyStore((s) => s.chapters).filter((c) => c.subjectId === subject.id).sort((a, b) => a.order - b.order);
  const updateChapter = useStudyStore((s) => s.updateChapter);
  if (chapters.length === 0) return <Card><EmptyState icon={StickyNote} title="No chapters" description="Add chapters to take notes." /></Card>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {chapters.map((c) => (
        <Card key={c.id}>
          <label htmlFor={`note-${c.id}`} className={labelClass}>{c.order}. {c.title}</label>
          <textarea id={`note-${c.id}`} rows={4} className={cn(fieldClass, 'h-auto py-2')} value={c.notes} onChange={(e) => updateChapter(c.id, { notes: e.target.value })} placeholder="No notes yet." />
        </Card>
      ))}
    </div>
  );
}
