import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { fieldClass, labelClass } from '@/components/ui/field';
import { chapterAccuracy, mockPercent } from '@/lib/analytics';
import { formatShortDate, todayISO } from '@/lib/dates';
import { formatPercent } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';
import type { Subject } from '@/types/study';

export function PracticeTab({ subject }: { subject: Subject }) {
  const allChapters = useStudyStore((s) => s.chapters);
  const chapters = allChapters.filter((c) => c.subjectId === subject.id).sort((a, b) => a.order - b.order);
  const mocks = useStudyStore((s) => s.mockExams).filter((m) => m.subjectId === subject.id).sort((a, b) => b.date.localeCompare(a.date));
  const logPractice = useStudyStore((s) => s.logPractice);
  const addMock = useStudyStore((s) => s.addMockExam);
  const deleteMock = useStudyStore((s) => s.deleteMockExam);

  const [chapterId, setChapterId] = useState(chapters[0]?.id ?? '');
  const [questions, setQuestions] = useState('');
  const [correct, setCorrect] = useState('');
  const [error, setError] = useState('');

  const [mockName, setMockName] = useState('');
  const [mockScore, setMockScore] = useState('');
  const [mockMax, setMockMax] = useState('100');
  const [mockError, setMockError] = useState('');

  const submitPractice = (e: FormEvent) => {
    e.preventDefault();
    const q = Number(questions);
    const c = Number(correct);
    if (!Number.isInteger(q) || q <= 0) return setError('Enter the number of questions attempted.');
    if (!Number.isInteger(c) || c < 0 || c > q) return setError('Correct answers must be between 0 and the questions attempted.');
    logPractice(chapterId, q, c);
    setQuestions('');
    setCorrect('');
    setError('');
  };

  const submitMock = (e: FormEvent) => {
    e.preventDefault();
    const score = Number(mockScore);
    const max = Number(mockMax);
    if (!mockName.trim()) return setMockError('Give the mock a name.');
    if (!(max > 0) || !(score >= 0) || score > max) return setMockError('Score must be between 0 and the maximum.');
    addMock({ date: todayISO(), subjectId: subject.id, name: mockName.trim(), score, maxScore: max });
    setMockName('');
    setMockScore('');
    setMockError('');
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="Log practice" description="Adds to chapter questions and accuracy." />
          <form onSubmit={submitPractice} className="space-y-4" noValidate>
            <div>
              <label className={labelClass} htmlFor="pr-ch">Chapter</label>
              <select id="pr-ch" className={fieldClass} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                {chapters.map((c) => <option key={c.id} value={c.id}>{c.order}. {c.title}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="pr-q">Questions attempted</label>
                <input id="pr-q" inputMode="numeric" className={fieldClass} value={questions} onChange={(e) => setQuestions(e.target.value)} />
              </div>
              <div>
                <label className={labelClass} htmlFor="pr-c">Correct</label>
                <input id="pr-c" inputMode="numeric" className={fieldClass} value={correct} onChange={(e) => setCorrect(e.target.value)} />
              </div>
            </div>
            {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
            <Button type="submit" variant="primary">Log practice</Button>
          </form>
        </Card>
        <Card>
          <CardHeader title="Mock examinations" description="Demo scores are included until you add your own." />
          <form onSubmit={submitMock} className="mb-5 grid grid-cols-[minmax(0,1fr)_72px_72px] gap-2" noValidate>
            <input aria-label="Mock name" placeholder="Mock name" className={fieldClass} value={mockName} onChange={(e) => setMockName(e.target.value)} />
            <input aria-label="Score" placeholder="Score" inputMode="decimal" className={fieldClass} value={mockScore} onChange={(e) => setMockScore(e.target.value)} />
            <input aria-label="Maximum score" placeholder="Max" inputMode="decimal" className={fieldClass} value={mockMax} onChange={(e) => setMockMax(e.target.value)} />
            {mockError && <p role="alert" className="col-span-3 text-[12px] text-red-500">{mockError}</p>}
            <Button type="submit" className="col-span-3">Add mock score</Button>
          </form>
          {mocks.length === 0 ? (
            <p className="text-[13px] text-ink-2">No mock scores for this paper yet.</p>
          ) : (
            <ul className="divide-y">
              {mocks.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-ink">{m.name}<span className="ml-2 text-ink-3">{formatShortDate(m.date)}</span></span>
                  <span className="font-semibold text-ink">{m.score}/{m.maxScore} · {formatPercent(mockPercent(m))}</span>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => deleteMock(m.id)} icon={<Trash2 className="size-4" />} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Accuracy by chapter" />
        <ul className="divide-y">
          {chapters.map((c) => {
            const acc = chapterAccuracy(c);
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="min-w-0 truncate text-ink">{c.title}</span>
                <span className="shrink-0 text-ink-2">{c.questionsPracticed} Qs · <span className={acc !== null && acc < 50 ? 'text-red-500' : 'text-ink'}>{acc === null ? '—' : formatPercent(acc)}</span></span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
