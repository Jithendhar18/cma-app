import { SUBJECTS } from '@/data/subjects';
import type { Subject } from '@/types/study';
import type { LibraryAdapter, LibraryDocument, LibraryNode, LibrarySource } from '@/types/library';

const MCQ_URL = 'https://icmai.in/ClntStudents/MCQBankPaper/3';
const MODEL_URL = 'https://icmai.in/ClntStudents/ClntMQPList';
const PREVIOUS_URL = 'https://icmai.in/ClntStudents/ClntQuestionPaperList?menuId=1';

const SESSIONS = [
  { year: '2025', session: 'December 2025' },
  { year: '2025', session: 'June 2025' },
  { year: '2024', session: 'December 2024' },
  { year: '2024', session: 'June 2024' },
];

function doc(partial: Omit<LibraryDocument, 'kind'> & { kind: string }): LibraryDocument {
  return partial;
}

function buildMcq(subjects: Subject[]): LibrarySource {
  const nodes: LibraryNode[] = Array.from(new Set(subjects.map((s) => s.group))).map((group) => ({
    id: `mcq-${group}`,
    label: group,
    children: subjects.filter((s) => s.group === group).map((subject) => ({
      id: `mcq-${subject.id}`,
      label: `Paper ${subject.paperNumber} · ${subject.shortName}`,
      documents: [1, 2, 3].map((n) =>
        doc({
          id: `mcq-${subject.id}-${n}`,
          title: `${subject.shortName} — MCQ Set ${n}`,
          kind: 'MCQ set',
          subjectId: subject.id,
          pages: 8 + n * 3,
          url: MCQ_URL,
        }),
      ),
    })),
  }));
  return {
    id: 'mcq',
    label: 'MCQ Bank',
    description: 'Objective question sets grouped by paper.',
    officialUrl: MCQ_URL,
    nodes,
  };
}

function buildModel(subjects: Subject[]): LibrarySource {
  return {
    id: 'model',
    label: 'Model Question Papers',
    description: 'Institute model papers by paper.',
    officialUrl: MODEL_URL,
    nodes: subjects.map((subject) => ({
      id: `model-${subject.id}`,
      label: `Paper ${subject.paperNumber} · ${subject.shortName}`,
      documents: [
        doc({ id: `model-${subject.id}-q`, title: `${subject.shortName} — Model Question Paper`, kind: 'Question paper', subjectId: subject.id, year: '2025', pages: 6, url: MODEL_URL }),
        doc({ id: `model-${subject.id}-a`, title: `${subject.shortName} — Suggested Answers`, kind: 'Answers', subjectId: subject.id, year: '2025', pages: 14, url: MODEL_URL }),
      ],
    })),
  };
}

function buildPrevious(subjects: Subject[]): LibrarySource {
  const years = Array.from(new Set(SESSIONS.map((s) => s.year)));
  return {
    id: 'previous',
    label: 'Previous Question Papers',
    description: 'Past examination papers by year and session.',
    officialUrl: PREVIOUS_URL,
    nodes: years.map((year) => ({
      id: `prev-${year}`,
      label: year,
      children: SESSIONS.filter((s) => s.year === year).map((s) => ({
        id: `prev-${s.session}`,
        label: s.session,
        documents: subjects.map((subject) =>
          doc({
            id: `prev-${s.session}-${subject.id}`,
            title: `${subject.shortName} — ${s.session}`,
            kind: 'Past paper',
            subjectId: subject.id,
            year: s.year,
            session: s.session,
            pages: 5,
            url: PREVIOUS_URL,
          }),
        ),
      })),
    })),
  };
}

/**
 * Demo adapter. It is NOT connected to ICMAI: every entry is generated locally.
 * A real adapter should implement the same `LibraryAdapter` shape.
 */
export const createDemoLibraryAdapter = (subjects: Subject[]): LibraryAdapter => ({
  id: 'demo',
  label: 'Demo data',
  isDemo: true,
  load: () =>
    new Promise((resolve) => {
      window.setTimeout(() => resolve([buildMcq(subjects), buildModel(subjects), buildPrevious(subjects)]), 450);
    }),
});

export const demoLibraryAdapter: LibraryAdapter = createDemoLibraryAdapter(SUBJECTS);

export function flattenDocuments(nodes: LibraryNode[], trail: string[] = []): Array<{ doc: LibraryDocument; trail: string[] }> {
  return nodes.flatMap((node) => [
    ...(node.documents ?? []).map((d) => ({ doc: d, trail: [...trail, node.label] })),
    ...flattenDocuments(node.children ?? [], [...trail, node.label]),
  ]);
}
