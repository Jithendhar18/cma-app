import { beforeEach, describe, expect, it } from 'vitest';
import { ATTEMPT, CSV, G1, G2, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { resourcesToSources, SupabaseCurriculum } from './supabaseCurriculum';

const USER = U(100);
let b: FakeBackend;
beforeEach(() => {
  b = createFakeBackend();
});
const repo = () => new SupabaseCurriculum(b.client);

describe('loadCurriculum', () => {
  it('loads the whole curriculum of one syllabus, validated and in official order', async () => {
    seedBackend(b, { userId: USER });
    b.signInAs(USER, 'a@example.test');
    const { tree, issues } = await repo().loadCurriculum(CSV);
    expect(issues).toEqual([]);
    expect(tree.groups.map((g) => g.name)).toEqual(['Group I', 'Group II']);
    expect(tree.subjects.map((s) => s.slug)).toEqual(['fake-one', 'fake-two', 'fake-three']);
    expect(tree.chapters.map((c) => c.title)).toEqual(['FAKE Chapter 1', 'FAKE Chapter 2', 'FAKE Chapter 3', 'FAKE Chapter 4', 'FAKE Chapter 5 (retired)']);
  });

  it('requests only published and retired rows, only for this syllabus, never a draft', async () => {
    seedBackend(b, { userId: USER });
    b.signInAs(USER, 'a@example.test');
    await repo().loadCurriculum(CSV);
    for (const call of b.calls.filter((c) => ['subject_groups', 'subjects', 'chapters', 'syllabus_sections', 'official_weightages'].includes(c.table))) {
      const status = call.filters.find(([c]) => c === 'status');
      expect(status, call.table).toBeDefined();
      expect(status?.[2]).toEqual(['published', 'retired']);
      expect(call.filters.find(([c]) => c === 'csv_id')?.[2]).toBe(CSV);
    }
  });

  it('shows only Group I when only Group I is published: Group II rows are never returned', async () => {
    seedBackend(b, { userId: USER, publishedGroups: [G1] });
    b.signInAs(USER, 'a@example.test');
    const { tree } = await repo().loadCurriculum(CSV);
    expect(tree.groups.map((g) => g.name)).toEqual(['Group I']);
    expect(tree.subjects.map((s) => s.slug)).toEqual(['fake-one', 'fake-two']);
    expect(tree.chapters.map((c) => c.id)).toEqual([U(21), U(22), U(23)]);
    expect(JSON.stringify(tree)).not.toContain('Subject Three');
  });

  it('exposes Group II later without changing a single existing id or key', async () => {
    seedBackend(b, { userId: USER, publishedGroups: [G1] });
    b.signInAs(USER, 'a@example.test');
    const before = (await repo().loadCurriculum(CSV)).tree;
    seedBackend(b, { userId: USER, publishedGroups: [G1, G2] });
    const after = (await repo().loadCurriculum(CSV)).tree;
    expect(after.groups.map((g) => g.id)).toEqual([G1, G2]);
    for (const s of before.subjects) expect(after.subjects.find((x) => x.id === s.id)).toEqual(s);
    for (const c of before.chapters) expect(after.chapters.find((x) => x.id === c.id)).toEqual(c);
    expect(after.chapters.length).toBeGreaterThan(before.chapters.length);
  });

  it('reads past the default 1,000-row API cap by paging explicitly', async () => {
    seedBackend(b, { userId: USER });
    const many = Array.from({ length: 2300 }, (_, i) => ({ id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`, csv_id: CSV, subject_id: U(11), section_id: null, stable_key: `many-${i}`, official_label: null, title: `Many ${i}`, sequence_no: i + 100, suggested_study_hours: null, status: 'published', updated_at: 'x' }));
    b.tables.chapters.push(...many);
    b.signInAs(USER, 'a@example.test');
    const { tree } = await repo().loadCurriculum(CSV);
    expect(tree.chapters.length).toBe(5 + 2300);
    const ranges = b.calls.filter((c) => c.table === 'chapters');
    expect(ranges.length).toBe(3); // 3 pages of up to 1000
  });

  it('fails as a whole (never partially) if a page cannot be read', async () => {
    seedBackend(b, { userId: USER });
    b.signInAs(USER, 'a@example.test');
    b.failNext('chapters', { code: '08006', message: 'connection lost' });
    await expect(repo().loadCurriculum(CSV)).rejects.toBeDefined();
  });

  it('skips and reports a malformed server row without failing the load', async () => {
    seedBackend(b, { userId: USER });
    b.tables.chapters.push({ id: U(555), csv_id: CSV, subject_id: U(11), section_id: null, stable_key: 'bad', official_label: null, title: '', sequence_no: 99, suggested_study_hours: null, status: 'published', updated_at: 'x' });
    b.signInAs(USER, 'a@example.test');
    const { tree, issues } = await repo().loadCurriculum(CSV);
    expect(tree.chapters.map((c) => c.id)).not.toContain(U(555));
    expect(issues).toEqual([{ table: 'chapters', id: U(555), problem: 'missing or malformed field' }]);
  });
});

describe('listEnrollmentOptions', () => {
  it('returns the published, enabled combinations from the view', async () => {
    seedBackend(b, { userId: USER, secondAttempt: true });
    b.signInAs(USER, 'a@example.test');
    const { options } = await repo().listEnrollmentOptions();
    expect(options.map((o) => o.attemptLabel)).toEqual(['FAKE attempt', 'FAKE attempt 2']);
    expect(options[0]).toMatchObject({ csvId: CSV, attemptId: ATTEMPT, examStartDate: null, dateStatus: 'unannounced' });
    expect(options[0].groups.map((g) => g.name)).toEqual(['Group I', 'Group II']);
  });
  it('returns an EMPTY list, not an error, when nothing is published (the real dataset today)', async () => {
    seedBackend(b, { userId: USER, publishedGroups: [] });
    b.signInAs(USER, 'a@example.test');
    expect(await repo().listEnrollmentOptions()).toEqual({ options: [], issues: [] });
  });
  it('offers only Group I when only Group I is published', async () => {
    seedBackend(b, { userId: USER, publishedGroups: [G1] });
    b.signInAs(USER, 'a@example.test');
    const { options } = await repo().listEnrollmentOptions();
    expect(options[0].groups.map((g) => g.name)).toEqual(['Group I']);
  });
  it('reads only from the view, never from a base table', async () => {
    seedBackend(b, { userId: USER });
    b.signInAs(USER, 'a@example.test');
    await repo().listEnrollmentOptions();
    expect([...new Set(b.calls.map((c) => c.table))]).toEqual(['enrollment_options']);
  });
});

describe('resources', () => {
  it('lists only published, active, https resources, grouped for the Library', async () => {
    seedBackend(b, { userId: USER });
    b.signInAs(USER, 'a@example.test');
    const sources = await repo().listResources(CSV);
    expect(sources.map((s) => s.label)).toEqual(['MCQ Bank']);
    const docs = sources[0].nodes[0].documents ?? [];
    expect(docs.map((d) => d.title)).toEqual(['FAKE published MCQ bank']);
    expect(JSON.stringify(sources)).not.toContain('DRAFT');
    expect(JSON.stringify(sources)).not.toContain('broken');
  });
  it('asks the server for published and active only (a draft or broken link is never requested)', async () => {
    seedBackend(b, { userId: USER });
    b.signInAs(USER, 'a@example.test');
    await repo().listResources(CSV);
    const call = b.calls.find((c) => c.table === 'study_resources');
    expect(call?.filters).toEqual(expect.arrayContaining([['status', 'eq', 'published'], ['link_status', 'eq', 'active']]));
  });
  it('defends again: even if a draft, broken or non-https row were returned it is dropped', () => {
    const row = (over: Record<string, unknown>) => ({ id: 'x', resource_type: 'notice', title: 'T', url: 'https://example.invalid/a', subject_id: null, year: null, session: null, link_status: 'active', status: 'published', is_official: true, ...over });
    expect(resourcesToSources([row({ status: 'draft' }), row({ link_status: 'broken' }), row({ url: 'http://example.invalid/a' }), row({ url: 'javascript:alert(1)' }), row({ id: null })])).toEqual([]);
    expect(resourcesToSources([row({})])).toHaveLength(1);
  });
});
