import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { fieldClass, labelClass } from '@/components/ui/field';
import { chapterAccuracy, CONFIDENCE_LABELS } from '@/lib/analytics';
import { formatShortDate } from '@/lib/dates';
import { formatHours, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { CHAPTER_STATUS_META, CHAPTER_STATUS_OPTIONS } from '@/lib/statusMeta';
import { useStudyStore } from '@/stores/studyStore';
import type { Chapter, ChapterStatus, ConfidenceLevel, Subject } from '@/types/study';

export function ChaptersTab({ subject, focusChapterId }: { subject: Subject; focusChapterId: string | null }) {
  const chapters = useStudyStore((s) => s.chapters).filter((c) => c.subjectId === subject.id).sort((a, b) => a.order - b.order);
  const [openId, setOpenId] = useState<string | null>(focusChapterId);

  useEffect(() => {
    if (!focusChapterId) return;
    setOpenId(focusChapterId);
    document.getElementById(`chapter-${focusChapterId}`)?.scrollIntoView({ block: 'center' });
  }, [focusChapterId]);

  return (
    <div className="space-y-3">
      {chapters.map((chapter) => (
        <ChapterRow key={chapter.id} chapter={chapter} open={openId === chapter.id} onToggle={() => setOpenId(openId === chapter.id ? null : chapter.id)} />
      ))}
    </div>
  );
}

function ChapterRow({ chapter, open, onToggle }: { chapter: Chapter; open: boolean; onToggle: () => void }) {
  const updateChapter = useStudyStore((s) => s.updateChapter);
  const next = useStudyStore((s) => s.revisions)
    .filter((r) => r.chapterId === chapter.id && !r.completedOn)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const accuracy = chapterAccuracy(chapter);
  const meta = CHAPTER_STATUS_META[chapter.status];

  return (
    <Card padded={false} className={cn(open && 'border-violet-500/40')}>
      <div id={`chapter-${chapter.id}`} />
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left md:px-5">
        <span className="w-6 shrink-0 text-[12px] text-ink-3">{chapter.order}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{chapter.title}</span>
          <span className="block text-[12px] text-ink-3">
            {formatHours(Math.round(chapter.actualHours * 10) / 10)} / {formatHours(chapter.estimatedHours)} · {accuracy === null ? 'No practice yet' : `${formatPercent(accuracy)} accuracy`}
          </span>
        </span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-5 border-t p-4 md:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`status-${chapter.id}`} className={labelClass}>Status</label>
              <select id={`status-${chapter.id}`} className={fieldClass} value={chapter.status} onChange={(e) => updateChapter(chapter.id, { status: e.target.value as ChapterStatus })}>
                {CHAPTER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <span className={labelClass} id={`conf-${chapter.id}`}>Confidence: {CONFIDENCE_LABELS[chapter.confidence]}</span>
              <div role="radiogroup" aria-labelledby={`conf-${chapter.id}`} className="flex gap-1.5">
                {([1, 2, 3, 4, 5] as ConfidenceLevel[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={chapter.confidence === n}
                    aria-label={`Confidence ${n}`}
                    onClick={() => updateChapter(chapter.id, { confidence: n })}
                    className={cn('h-9 flex-1 rounded-lg border text-[13px] font-medium transition-colors', chapter.confidence === n ? 'border-violet-500 bg-violet-500/15 text-ink' : 'text-ink-2 hover:text-ink')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Questions practised" value={String(chapter.questionsPracticed)} />
            <Fact label="Accuracy" value={accuracy === null ? '—' : formatPercent(accuracy)} />
            <Fact label="Last studied" value={chapter.lastStudied ? formatShortDate(chapter.lastStudied) : 'Never'} />
            <Fact label="Next revision" value={next ? formatShortDate(next.dueDate) : '—'} />
          </dl>
          <div>
            <label htmlFor={`notes-${chapter.id}`} className={labelClass}>Notes</label>
            <textarea id={`notes-${chapter.id}`} rows={3} className={cn(fieldClass, 'h-auto py-2')} value={chapter.notes} onChange={(e) => updateChapter(chapter.id, { notes: e.target.value })} placeholder="Key formulas, traps, things to revisit…" />
          </div>
        </div>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="text-[13px] font-semibold text-ink">{value}</dd>
    </div>
  );
}
