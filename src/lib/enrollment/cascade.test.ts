import { describe, expect, it } from 'vitest';
import type { EnrollmentOption } from '@/lib/curriculum/types';
import { G1, G2, U } from '@/test/accountFixtures';
import { autoSelect, choicesFor, EMPTY_SELECTION, resolveSelection, select } from './cascade';

const opt = (over: Partial<EnrollmentOption>): EnrollmentOption => ({
  courseId: U(950), courseName: 'Course A', courseOrder: 1, csvId: U(900), syllabusVersionId: U(951), syllabusName: 'Syllabus 1', attemptId: U(901), attemptLabel: 'Dec 2026',
  attemptYear: 2026, attemptSession: 'december', examStartDate: null, examEndDate: null, dateStatus: 'unannounced', groups: [{ id: G1, name: 'Group I' }, { id: G2, name: 'Group II' }], ...over,
});
const ONE = [opt({})];
const MANY = [
  opt({}),
  opt({ attemptId: U(902), attemptLabel: 'Jun 2027', attemptYear: 2027, attemptSession: 'june', examStartDate: '2027-06-01', dateStatus: 'official' }),
  opt({ syllabusVersionId: U(952), syllabusName: 'Syllabus 2', csvId: U(910), attemptId: U(903), attemptLabel: 'Dec 2028', attemptYear: 2028 }),
  opt({ courseId: U(960), courseName: 'Course B', courseOrder: 2, csvId: U(920), syllabusVersionId: U(961), syllabusName: 'B Syllabus', attemptId: U(904), attemptLabel: 'B Attempt', groups: [{ id: U(5), name: 'Only Group' }] }),
];

describe('cascading choices', () => {
  it('lists courses in course order, then only what belongs under the choice above', () => {
    const none = choicesFor(MANY, EMPTY_SELECTION);
    expect(none.courses.map((c) => c.name)).toEqual(['Course A', 'Course B']);
    expect(none.syllabi).toEqual([]);
    const a = choicesFor(MANY, { ...EMPTY_SELECTION, courseId: U(950) });
    expect(a.syllabi.map((s) => s.name)).toEqual(['Syllabus 1', 'Syllabus 2']);
    const att = choicesFor(MANY, { courseId: U(950), syllabusVersionId: U(951), attemptId: null, groupIds: [] });
    expect(att.attempts.map((x) => x.attemptLabel)).toEqual(['Dec 2026', 'Jun 2027']);
    expect(choicesFor(MANY, { courseId: U(950), syllabusVersionId: U(951), attemptId: U(901), groupIds: [] }).groups.map((g) => g.name)).toEqual(['Group I', 'Group II']);
  });

  it('resets every downstream choice when an upstream one changes', () => {
    const full = { courseId: U(950), syllabusVersionId: U(951), attemptId: U(901), groupIds: [G1] };
    expect(select(MANY, full, { courseId: U(960) })).toMatchObject({ courseId: U(960), syllabusVersionId: U(961), attemptId: U(904) }); // the new course's only options are auto-selected
    expect(select(MANY, full, { courseId: U(960) }).groupIds).toEqual([]);
    expect(select(MANY, full, { syllabusVersionId: U(952) })).toMatchObject({ syllabusVersionId: U(952), attemptId: U(903), groupIds: [] });
    expect(select(MANY, full, { attemptId: U(902) })).toMatchObject({ attemptId: U(902), groupIds: [] });
  });

  it('keeps downstream choices when the same upstream value is chosen again', () => {
    const full = { courseId: U(950), syllabusVersionId: U(951), attemptId: U(901), groupIds: [G1] };
    expect(select(MANY, full, { courseId: U(950) })).toEqual(full);
  });

  it('selects a sole option at every level automatically (it is still shown)', () => {
    expect(autoSelect(ONE, EMPTY_SELECTION)).toEqual({ courseId: U(950), syllabusVersionId: U(951), attemptId: U(901), groupIds: [] });
    expect(choicesFor(ONE, autoSelect(ONE, EMPTY_SELECTION)).courses).toHaveLength(1);
  });

  it('does not select anything when there is a real choice', () => {
    expect(autoSelect(MANY, EMPTY_SELECTION)).toEqual(EMPTY_SELECTION);
  });

  it('offers nothing at all when there are no options', () => {
    expect(choicesFor([], EMPTY_SELECTION)).toEqual({ courses: [], syllabi: [], attempts: [], groups: [] });
    expect(autoSelect([], EMPTY_SELECTION)).toEqual(EMPTY_SELECTION);
  });
});

describe('resolveSelection', () => {
  const all = { courseId: U(950), syllabusVersionId: U(951), attemptId: U(901) };
  it('accepts Group I, Group II or both', () => {
    for (const groupIds of [[G1], [G2], [G1, G2]]) expect(resolveSelection(ONE, { ...all, groupIds })).toMatchObject({ ok: true, groupIds });
  });
  it('de-duplicates groups', () => {
    expect(resolveSelection(ONE, { ...all, groupIds: [G1, G1] })).toMatchObject({ ok: true, groupIds: [G1] });
  });
  it('reports the first missing step, in order', () => {
    expect(resolveSelection(ONE, EMPTY_SELECTION)).toEqual({ ok: false, problem: 'course' });
    expect(resolveSelection(ONE, { ...EMPTY_SELECTION, courseId: U(950) })).toEqual({ ok: false, problem: 'syllabus' });
    expect(resolveSelection(ONE, { ...EMPTY_SELECTION, courseId: U(950), syllabusVersionId: U(951) })).toEqual({ ok: false, problem: 'attempt' });
    expect(resolveSelection(ONE, { ...all, groupIds: [] })).toEqual({ ok: false, problem: 'groups' });
  });
  it('refuses a group that is not offered for that attempt (for example a draft group), and a combination that does not exist', () => {
    expect(resolveSelection(ONE, { ...all, groupIds: [U(77)] })).toEqual({ ok: false, problem: 'unavailable' });
    expect(resolveSelection([opt({ groups: [{ id: G1, name: 'Group I' }] })], { ...all, groupIds: [G2] })).toEqual({ ok: false, problem: 'unavailable' });
    expect(resolveSelection(ONE, { courseId: U(950), syllabusVersionId: U(951), attemptId: U(999), groupIds: [G1] })).toEqual({ ok: false, problem: 'unavailable' });
  });
  it('says nothing about a date it does not have', () => {
    const r = resolveSelection(ONE, { ...all, groupIds: [G1] });
    expect(r.ok && r.option.examStartDate).toBeNull();
  });
});
