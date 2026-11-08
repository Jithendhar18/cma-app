import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { LibraryDocument, LibrarySource } from '@/types/library';
import { fetchAllPages } from './paging';
import type { CurriculumRepository, DataIssue, EnrollmentOption } from './types';
import { assembleCurriculum, parseEnrollmentOption } from './validate';

/** Only these two statuses are ever requested. Draft rows are never asked for (and the database policy would hide them anyway). */
const VISIBLE = ['published', 'retired'] as const;

const RESOURCE_LABELS: Record<string, { id: string; label: string; description: string }> = {
  study_material: { id: 'study', label: 'Study Materials', description: 'Official study notes and supplementary material.' },
  mcq_bank: { id: 'mcq', label: 'MCQ Bank', description: 'Official multiple-choice question banks.' },
  model_question_paper: { id: 'model', label: 'Model Question Papers', description: 'Official model question papers.' },
  previous_question_paper: { id: 'previous', label: 'Previous Question Papers', description: 'Past examination papers.' },
  notice: { id: 'notice', label: 'Notices', description: 'Official notices and circulars.' },
  timetable: { id: 'timetable', label: 'Timetables', description: 'Official examination timetables.' },
  other: { id: 'other', label: 'Other Resources', description: 'Other official resources.' },
};

const SESSION_LABEL = { june: 'June', december: 'December' } as const;

type ResourceRowLike = {
  id: string; resource_type: string; title: string; url: string; subject_id: string | null; year: number | null; session: 'june' | 'december' | null;
  link_status: string; status: string; is_official: boolean;
};

/** Groups resource rows into the Library's own source model. Only published, active, official https links are kept. */
export function resourcesToSources(rows: unknown[]): LibrarySource[] {
  const bySource = new Map<string, { meta: (typeof RESOURCE_LABELS)[string]; docs: LibraryDocument[] }>();
  for (const raw of rows) {
    const r = raw as Partial<ResourceRowLike>;
    if (typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.url !== 'string' || typeof r.resource_type !== 'string') continue;
    if (r.status !== 'published' || r.link_status !== 'active' || !/^https:\/\/\S+$/.test(r.url)) continue;
    const meta = RESOURCE_LABELS[r.resource_type] ?? RESOURCE_LABELS.other;
    const entry = bySource.get(meta.id) ?? { meta, docs: [] };
    entry.docs.push({
      id: r.id,
      title: r.title,
      kind: meta.label,
      ...(r.subject_id ? { subjectId: r.subject_id } : {}),
      ...(typeof r.year === 'number' ? { year: String(r.year) } : {}),
      ...(r.session ? { session: `${SESSION_LABEL[r.session]}${typeof r.year === 'number' ? ` ${r.year}` : ''}` } : {}),
      url: r.url,
    });
    bySource.set(meta.id, entry);
  }
  return [...bySource.values()].map(({ meta, docs }) => ({
    id: meta.id,
    label: meta.label,
    description: meta.description,
    officialUrl: 'https://icmai.in/',
    nodes: [{ id: `${meta.id}-all`, label: meta.label, documents: docs }],
  }));
}

export class SupabaseCurriculum implements CurriculumRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async listEnrollmentOptions(): Promise<{ options: EnrollmentOption[]; issues: DataIssue[] }> {
    const rows = await fetchAllPages((from, to) =>
      this.client.from('enrollment_options').select('*').order('course_order').order('csv_id').order('exam_attempt_id').range(from, to),
    );
    const issues: DataIssue[] = [];
    const options = rows.map((r) => parseEnrollmentOption(r, issues)).filter((o): o is EnrollmentOption => o !== null);
    return { options, issues };
  }

  async loadCurriculum(csvId: string) {
    const [groups, subjects, sections, chapters, weightages] = await Promise.all([
      fetchAllPages((from, to) => this.client.from('subject_groups').select('*').eq('csv_id', csvId).in('status', [...VISIBLE]).order('id').range(from, to)),
      fetchAllPages((from, to) => this.client.from('subjects').select('*').eq('csv_id', csvId).in('status', [...VISIBLE]).order('id').range(from, to)),
      fetchAllPages((from, to) => this.client.from('syllabus_sections').select('*').eq('csv_id', csvId).in('status', [...VISIBLE]).order('id').range(from, to)),
      fetchAllPages((from, to) => this.client.from('chapters').select('*').eq('csv_id', csvId).in('status', [...VISIBLE]).order('id').range(from, to)),
      fetchAllPages((from, to) => this.client.from('official_weightages').select('*').eq('csv_id', csvId).in('status', [...VISIBLE]).order('id').range(from, to)),
    ]);
    return assembleCurriculum({ groups, subjects, sections, chapters, weightages });
  }

  async listResources(csvId: string): Promise<LibrarySource[]> {
    const rows = await fetchAllPages((from, to) =>
      this.client.from('study_resources').select('*').eq('status', 'published').eq('link_status', 'active').or(`csv_id.eq.${csvId},csv_id.is.null`).order('id').range(from, to),
    );
    return resourcesToSources(rows);
  }
}
