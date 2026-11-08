import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { fieldClass, labelClass } from '@/components/ui/field';
import { autoSelect, choicesFor, EMPTY_SELECTION, resolveSelection, select, type Selection, type SelectionProblem } from '@/lib/enrollment/cascade';
import type { EnrollmentOption } from '@/lib/curriculum/types';
import { classifyEnrollmentError, type NewEnrollment } from '@/lib/enrollment/types';
import { describeExamDate } from './examDate';
import { Notice } from '@/features/auth/components/Notice';

const PROBLEM_TEXT: Record<SelectionProblem, string> = {
  course: 'Choose a course.',
  syllabus: 'Choose a syllabus version.',
  attempt: 'Choose an exam attempt.',
  groups: 'Choose at least one group.',
  unavailable: 'That combination is not available. Choose again.',
};

interface EnrollmentFormProps {
  options: EnrollmentOption[];
  submitLabel: string;
  replaceActive?: boolean;
  onSubmit: (input: NewEnrollment) => Promise<void>;
  onCancel?: () => void;
  /** Called when the server says an enrolment already exists, so the screen can recover by re-reading it. */
  onAlreadyActive?: () => void;
}

/**
 * The four cascading controls: course, syllabus version, exam attempt, groups. Everything offered comes from `enrollment_options`; a level
 * with a single option is selected for the student but still shown. Changing an upstream choice clears everything below it.
 */
export function EnrollmentForm({ options, submitLabel, replaceActive, onSubmit, onCancel, onAlreadyActive }: EnrollmentFormProps) {
  const [sel, setSel] = useState<Selection>(() => autoSelect(options, EMPTY_SELECTION));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<SelectionProblem | null>(null);

  // If the options change underneath the form (a refresh), keep what is still valid and drop what is not.
  useEffect(() => {
    setSel((cur) => (resolveSelection(options, { ...cur, groupIds: cur.groupIds }).ok || cur.courseId === null ? autoSelect(options, cur) : autoSelect(options, EMPTY_SELECTION)));
  }, [options]);

  const choices = useMemo(() => choicesFor(options, sel), [options, sel]);
  const chosenOption = options.find((o) => o.courseId === sel.courseId && o.syllabusVersionId === sel.syllabusVersionId && o.attemptId === sel.attemptId);

  // A single group is selected for the student (and shown).
  useEffect(() => {
    if (chosenOption && chosenOption.groups.length === 1 && sel.groupIds.length === 0) setSel((cur) => ({ ...cur, groupIds: [chosenOption.groups[0].id] }));
  }, [chosenOption, sel.groupIds.length]);

  const change = (c: Partial<Selection>) => {
    setProblem(null);
    setMessage(null);
    setSel((cur) => select(options, cur, c));
  };
  const toggleGroup = (id: string) => change({ groupIds: sel.groupIds.includes(id) ? sel.groupIds.filter((g) => g !== id) : [...sel.groupIds, id] });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const resolved = resolveSelection(options, sel);
    if (!resolved.ok) {
      setProblem(resolved.problem);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onSubmit({ csvId: resolved.option.csvId, attemptId: resolved.option.attemptId, groupIds: resolved.groupIds, replaceActive });
    } catch (e) {
      const err = classifyEnrollmentError(e);
      setMessage(err.message);
      if (err.kind === 'already-active') onAlreadyActive?.();
    } finally {
      setBusy(false);
    }
  }

  const select_ = (id: string, label: string, value: string | null, items: Array<{ id: string; name: string }>, onChange: (v: string) => void, disabled = false) => (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} className={fieldClass} value={value ?? ''} disabled={disabled || items.length === 0} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Select…</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {select_('en-course', 'Course', sel.courseId, choices.courses, (v) => change({ courseId: v }))}
      {select_('en-syllabus', 'Syllabus version', sel.syllabusVersionId, choices.syllabi, (v) => change({ syllabusVersionId: v }), sel.courseId === null)}
      {select_('en-attempt', 'Exam attempt', sel.attemptId, choices.attempts.map((a) => ({ id: a.attemptId, name: a.attemptLabel })), (v) => change({ attemptId: v }), sel.syllabusVersionId === null)}
      {chosenOption && <p className="-mt-2 text-[12px] text-ink-3">{describeExamDate(chosenOption)}</p>}
      <fieldset disabled={!chosenOption}>
        <legend className={labelClass}>Groups</legend>
        {choices.groups.length === 0 ? (
          <p className="text-[12px] text-ink-3">Choose an exam attempt to see its groups.</p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {choices.groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" className="size-4 accent-violet-500" checked={sel.groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} /> {g.name}
              </label>
            ))}
            {choices.groups.length > 1 && (
              <button type="button" className="text-[12px] font-medium text-violet-500 hover:underline" onClick={() => change({ groupIds: sel.groupIds.length === choices.groups.length ? [] : choices.groups.map((g) => g.id) })}>
                {sel.groupIds.length === choices.groups.length ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
        )}
      </fieldset>
      {problem && <p role="alert" className="text-[12px] text-red-500">{PROBLEM_TEXT[problem]}</p>}
      {message && <Notice tone="error">{message}</Notice>}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </form>
  );
}
