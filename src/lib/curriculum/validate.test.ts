import { describe, expect, it } from 'vitest';
import { G1, G2, U } from '@/test/accountFixtures';
import type { DataIssue } from './types';
import { assembleCurriculum, parseChapter, parseEnrollmentOption, parseGroup, parseSubject } from './validate';

const group = (id: string, name: string, order: number, status = 'published') => ({ id, name, sort_order: order, status });
const subject = (id: string, g: string, slug: string, paper: number, order: number, status = 'published') => ({ id, subject_group_id: g, slug, paper_number: paper, name: `S${paper}`, short_name: `s${paper}`, sort_order: order, status });
const chapter = (id: string, s: string, order: number, over: Record<string, unknown> = {}) => ({ id, subject_id: s, section_id: null, official_label: String(order), title: `C${order}`, sequence_no: order, suggested_study_hours: null, status: 'published', ...over });

const RAW = {
  groups: [group(G2, 'Group II', 2), group(G1, 'Group I', 1)],
  subjects: [subject(U(13), G2, 'three', 3, 1), subject(U(12), G1, 'two', 2, 2), subject(U(11), G1, 'one', 1, 1)],
  sections: [],
  chapters: [chapter(U(24), U(13), 1), chapter(U(22), U(11), 2), chapter(U(21), U(11), 1), chapter(U(23), U(12), 1)],
  weightages: [],
};

describe('assembleCurriculum', () => {
  it('returns the official order whatever order the server sent: groups, then papers within a group, then chapters', () => {
    const { tree, issues } = assembleCurriculum(RAW);
    expect(issues).toEqual([]);
    expect(tree.groups.map((g) => g.name)).toEqual(['Group I', 'Group II']);
    expect(tree.subjects.map((s) => s.slug)).toEqual(['one', 'two', 'three']);
    expect(tree.chapters.map((c) => c.id)).toEqual([U(21), U(22), U(23), U(24)]);
  });

  it('uses the group NAME as the subject\'s group, as every existing page expects', () => {
    const { tree } = assembleCurriculum(RAW);
    expect(tree.subjects.map((s) => s.group)).toEqual(['Group I', 'Group I', 'Group II']);
    expect(tree.subjects[0].groupId).toBe(G1);
  });

  it('maps a null study-hours estimate to 0 and never invents one', () => {
    const { tree } = assembleCurriculum({ ...RAW, chapters: [chapter(U(21), U(11), 1), chapter(U(22), U(11), 2, { suggested_study_hours: 6.5 })] });
    expect(tree.chapters.map((c) => c.estimatedHours)).toEqual([0, 6.5]);
  });

  it('keeps a retired chapter, flagged, so recorded progress is never orphaned', () => {
    const { tree } = assembleCurriculum({ ...RAW, chapters: [chapter(U(21), U(11), 1, { status: 'retired' })] });
    expect(tree.chapters[0].retired).toBe(true);
  });

  it('NEVER accepts a draft row, even if the server were to send one', () => {
    const { tree, issues } = assembleCurriculum({
      ...RAW,
      groups: [...RAW.groups, group(U(3), 'Group III', 3, 'draft')],
      subjects: [...RAW.subjects, subject(U(14), U(3), 'draft-subject', 9, 9)],
      chapters: [...RAW.chapters, chapter(U(26), U(11), 9, { status: 'draft' })],
    });
    expect(tree.groups.map((g) => g.id)).not.toContain(U(3));
    expect(tree.chapters.map((c) => c.id)).not.toContain(U(26));
    expect(tree.subjects.map((s) => s.slug)).not.toContain('draft-subject'); // its group was refused, so it has nowhere to attach
    expect(issues.map((i) => i.table).sort()).toEqual(['chapters', 'subject_groups', 'subjects']);
  });

  it('skips and reports a chapter that points at a subject which is not in the payload', () => {
    const { tree, issues } = assembleCurriculum({ ...RAW, chapters: [...RAW.chapters, chapter(U(27), U(99), 1)] });
    expect(tree.chapters.map((c) => c.id)).not.toContain(U(27));
    expect(issues).toContainEqual({ table: 'chapters', id: U(27), problem: 'refers to a subject that is not in this curriculum' });
  });

  it('skips and reports malformed rows instead of applying them or throwing', () => {
    const { tree, issues } = assembleCurriculum({
      ...RAW,
      subjects: [...RAW.subjects, { ...subject(U(15), G1, 'Bad Slug!', 5, 5) }, { id: 'not-a-uuid', subject_group_id: G1 }, null, 'text', 7],
      chapters: [...RAW.chapters, chapter(U(28), U(11), 3, { title: '' }), chapter(U(29), U(11), 4, { sequence_no: 'x' }), chapter(U(30), U(11), 5, { suggested_study_hours: -1 })],
    });
    expect(tree.subjects).toHaveLength(3);
    expect(tree.chapters).toHaveLength(4);
    expect(issues.length).toBeGreaterThanOrEqual(7);
  });

  it('accepts string-typed numeric weightages (the database returns numeric as text in some clients) and refuses impossible ones', () => {
    const w = (id: string, over: Record<string, unknown>) => ({ id, level: 'chapter', subject_id: null, section_id: null, chapter_id: U(21), min_percent: '10', max_percent: '10.5', published_label: '10%', status: 'published', ...over });
    const { tree } = assembleCurriculum({ ...RAW, weightages: [w(U(40), {}), w(U(41), { min_percent: 80, max_percent: 20 }), w(U(42), { max_percent: 101 }), w(U(43), { chapter_id: U(99) }), w(U(44), { level: 'unknown' })] });
    expect(tree.weightages.map((x) => x.id)).toEqual([U(40)]);
    expect(tree.weightages[0]).toMatchObject({ minPercent: 10, maxPercent: 10.5, targetId: U(21) });
  });
});

describe('row parsers', () => {
  const issues: DataIssue[] = [];
  it('reject non-objects without throwing', () => {
    for (const bad of [null, undefined, 'x', 1, [], true]) {
      expect(parseGroup(bad, issues)).toBeNull();
      expect(parseSubject(bad, new Map(), issues)).toBeNull();
      expect(parseChapter(bad, new Map(), issues)).toBeNull();
    }
  });
  it('require UUID ids and URL-safe slugs', () => {
    expect(parseGroup({ id: '1', name: 'G', sort_order: 1, status: 'published' }, issues)).toBeNull();
    expect(parseGroup({ id: G1, name: 'G', sort_order: 1, status: 'published' }, issues)).not.toBeNull();
  });
});

describe('parseEnrollmentOption', () => {
  const ok = { course_id: U(950), course_name: 'C', course_order: 1, csv_id: U(900), syllabus_version_id: U(951), syllabus_name: 'S', exam_attempt_id: U(901), attempt_label: 'A', attempt_year: 2026, attempt_session: 'december', exam_start_date: null, exam_end_date: null, date_status: 'unannounced', groups: [{ id: G1, name: 'Group I' }] };
  it('accepts a complete option, with an unannounced date left null', () => {
    const issues: DataIssue[] = [];
    expect(parseEnrollmentOption(ok, issues)).toMatchObject({ examStartDate: null, dateStatus: 'unannounced', groups: [{ id: G1, name: 'Group I' }] });
    expect(issues).toEqual([]);
  });
  it('refuses an option with no group, and a date status that claims a date the row does not have', () => {
    const issues: DataIssue[] = [];
    expect(parseEnrollmentOption({ ...ok, groups: [] }, issues)).toBeNull();
    expect(parseEnrollmentOption({ ...ok, date_status: 'official', exam_start_date: null }, issues)).toBeNull();
    expect(issues).toHaveLength(2);
  });
  it('ignores malformed groups but keeps the valid ones', () => {
    expect(parseEnrollmentOption({ ...ok, groups: [{ id: G1, name: 'Group I' }, { id: 'x' }, null, { id: G2, name: 5 }] }, [])?.groups).toEqual([{ id: G1, name: 'Group I' }]);
  });
});
