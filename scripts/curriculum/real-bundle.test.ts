/**
 * Data checks for the REAL CMA Intermediate bundle (supabase/curriculum/bundles/cma-intermediate-2022).
 *
 * These guard the transcription of the official ICMAI syllabus: counts, order, weightages, the absence of invented
 * data, and the honesty of the verification fields. They are written to keep passing after a human reviewer publishes
 * the records, so they never assert that everything is still a draft.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashBundle, loadBundle } from './bundle-io.ts';
import { findUnsafeSql, generateSql } from './generate-sql.ts';
import { renderOutline, renderResources } from './outline.ts';
import type { Bundle, ChapterDef } from './types.ts';
import { validateBundle } from './validate.ts';

const ROOT = resolve(__dirname, '../..');
const load = (): Bundle => loadBundle(resolve(ROOT, 'supabase/curriculum/bundles/cma-intermediate-2022'), resolve(ROOT, 'supabase/curriculum/shared'));
const TODAY = '2026-11-08';

// Paper number -> [name, short name, group, sections, modules]
const PAPERS: Record<number, [string, string, string, number, number]> = {
  5: ['Business Laws and Ethics', 'BLE', 'group-1', 4, 13],
  6: ['Financial Accounting', 'FA', 'group-1', 6, 9],
  7: ['Direct and Indirect Taxation', 'DITX', 'group-1', 2, 6],
  8: ['Cost Accounting', 'CA', 'group-1', 3, 6],
  9: ['Operations Management and Strategic Management', 'OMSM', 'group-2', 2, 11],
  10: ['Corporate Accounting and Auditing', 'CAA', 'group-2', 2, 8],
  11: ['Financial Management and Business Data Analytics', 'FMDA', 'group-2', 2, 11],
  12: ['Management Accounting', 'MA', 'group-2', 8, 10],
};

// Modules whose weight is ONE merged cell shared with neighbours in the published table (confirmed from the PDF
// layout and by the arithmetic). The syllabus gives no weight for the individual module, so none may be recorded.
const SHARED_WEIGHT: Record<string, number[]> = { ble: [5, 6, 7, 8, 9, 10], fa: [5, 6, 7, 8], ma: [3, 4, 5] };

describe('the real CMA Intermediate bundle', () => {
  const bundle = load();
  const subjectOf = (paper: number) => bundle.subjects.find((s) => s.paperNumber === paper)!;
  const chaptersOf = (key: string) => bundle.chapters.filter((c) => c.subject === key).sort((a, b) => a.sequenceNo - b.sequenceNo);
  const weightOf = (target: string) => bundle.weightages.filter((w) => w.target === target);

  it('passes the importer validator', () => {
    expect(validateBundle(bundle, { today: TODAY })).toEqual([]);
  });

  it('matches the reviewed outline exactly (titles, order and weights)', () => {
    // The golden file is what a reviewer compared with the ICMAI PDFs. Changing a title, an order or a weight must be a
    // deliberate edit of that file in the same pull request, so it cannot slip through unreviewed.
    const golden = readFileSync(resolve(__dirname, '__fixtures__/real-bundle-outline.txt'), 'utf8');
    expect(renderOutline(bundle)).toBe(golden);
  });

  it('matches the reviewed resource listing exactly (keys, types, papers, terms, URLs)', () => {
    const golden = readFileSync(resolve(__dirname, '__fixtures__/real-bundle-resources.txt'), 'utf8');
    expect(renderResources(bundle)).toBe(golden);
  });

  describe('official resources', () => {
    const byType = (type: string) => bundle.resources.filter((r) => r.resourceType === type);
    const papersOf = (type: string) =>
      byType(type).map((r) => bundle.subjects.find((s) => s.stableKey === r.scope.subject)?.paperNumber ?? 0).sort((a, b) => a - b);

    it('has the verified set: study notes, supplementaries, model papers, MCQ banks, practice papers, the circular and the time table', () => {
      expect(bundle.resources).toHaveLength(45);
      expect(byType('timetable')).toHaveLength(1);
      expect(byType('notice')).toHaveLength(1);
      expect(byType('mcq_bank')).toHaveLength(8);
      expect(byType('model_question_paper')).toHaveLength(6);
      expect(byType('other')).toHaveLength(16);
      expect(byType('study_material')).toHaveLength(13); // 9 study notes + 4 supplementaries
    });

    it('lists model papers only for the papers ICMAI has published for December 2026 (not Papers 5 and 9)', () => {
      expect(papersOf('model_question_paper')).toEqual([6, 7, 8, 10, 11, 12]);
      for (const r of byType('model_question_paper')) expect([r.year, r.session, r.scope.attempt]).toEqual([2026, 'december', 'dec-2026']);
    });

    it('keeps supplementary material as resources for exactly Papers 5, 6, 7A and 7B, never as papers or chapters', () => {
      const supplementary = bundle.resources.filter((r) => r.stableKey.startsWith('supp-dec2026-'));
      expect(supplementary.map((r) => r.stableKey)).toEqual(['supp-dec2026-p05', 'supp-dec2026-p06', 'supp-dec2026-p07a', 'supp-dec2026-p07b']);
      for (const r of supplementary) expect([r.resourceType, r.year, r.session, r.scope.attempt, r.scope.chapter]).toEqual(['study_material', 2026, 'december', 'dec-2026', null]);
      expect(bundle.subjects).toHaveLength(8);
      expect(bundle.chapters.some((c) => /supplement/i.test(c.title))).toBe(false);
    });

    it('does not tie practice test papers to the December 2026 attempt: they are June 2026 documents', () => {
      const practice = byType('other');
      expect(practice).toHaveLength(16);
      for (const r of practice) expect([r.year, r.session, r.scope.attempt]).toEqual([2026, 'june', null]);
    });

    it('ties study notes to December 2026 only where the circular covers the paper (5, 6, 7, 8, 10)', () => {
      const tied = byType('study_material').filter((r) => r.stableKey.startsWith('sm-') && r.scope.attempt === 'dec-2026');
      expect(tied.map((r) => bundle.subjects.find((s) => s.stableKey === r.scope.subject)!.paperNumber)).toEqual([5, 6, 7, 7, 8, 10]);
      const untied = byType('study_material').filter((r) => r.stableKey.startsWith('sm-') && r.scope.attempt === null);
      expect(untied.map((r) => bundle.subjects.find((s) => s.stableKey === r.scope.subject)!.paperNumber)).toEqual([9, 11, 12]);
      for (const r of untied) expect([r.year, r.session]).toEqual([null, null]);
    });

    it('MCQ banks state no term, because the official page and documents state none', () => {
      expect(papersOf('mcq_bank')).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
      for (const r of byType('mcq_bank')) expect([r.year, r.session, r.scope.attempt]).toEqual([null, null, null]);
    });

    it('every resource is official, https, on an ICMAI host, cites the page it came from, and is not yet verified', () => {
      const sourceKeys = new Map(bundle.sources.map((s) => [s.stableKey, s]));
      for (const r of bundle.resources) {
        expect(r.isOfficial).toBe(true);
        expect(r.url).toMatch(/^https:\/\/dwpivt501gtb6\.cloudfront\.net\/upload\/students\//);
        expect(r.url).not.toMatch(/\s/);
        expect(sourceKeys.has(r.sourceRef ?? '')).toBe(true);
        expect(r.linkStatus).toBe('active');
        expect(r.lastCheckedAt).toBe('2026-11-08');
      }
      expect(new Set(bundle.resources.map((r) => r.url)).size).toBe(bundle.resources.length);
    });

    it('records the circular\'s publication date as printed, and no other source invents one', () => {
      const circular = bundle.sources.find((s) => s.stableKey === 'icmai-clarification-dec-2026-circular')!;
      expect(circular.publishedOn).toBe('2026-09-15');
      expect(bundle.sources.filter((s) => s.publishedOn !== null).map((s) => s.stableKey)).toEqual(['icmai-clarification-dec-2026-circular']);
    });
  });

  it('is the real bundle: nothing fake', () => {
    expect(bundle.meta.bundleKey).toBe('cma-intermediate.syllabus-2022');
    expect(JSON.stringify(bundle)).not.toMatch(/fake|example\.invalid/i);
  });

  it('has exactly the eight official papers in two groups, with their official names', () => {
    expect(bundle.groups.map((g) => [g.stableKey, g.name])).toEqual([['group-1', 'Group I'], ['group-2', 'Group II']]);
    expect(bundle.subjects).toHaveLength(8);
    for (const [paper, [name, short, group]] of Object.entries(PAPERS)) {
      const s = subjectOf(Number(paper));
      expect(s, `paper ${paper}`).toBeDefined();
      expect([s.name, s.shortName, s.group]).toEqual([name, short, group]);
    }
    // order inside each group follows the paper number
    expect(bundle.subjects.filter((s) => s.group === 'group-1').sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.paperNumber)).toEqual([5, 6, 7, 8]);
    expect(bundle.subjects.filter((s) => s.group === 'group-2').sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.paperNumber)).toEqual([9, 10, 11, 12]);
  });

  it('has the official number of sections and modules per paper (29 sections, 74 modules)', () => {
    expect(bundle.sections).toHaveLength(29);
    expect(bundle.chapters).toHaveLength(74);
    for (const [paper, [, , , sections, modules]] of Object.entries(PAPERS)) {
      const key = subjectOf(Number(paper)).stableKey;
      expect(bundle.sections.filter((s) => s.subject === key), `sections of paper ${paper}`).toHaveLength(sections);
      expect(chaptersOf(key), `modules of paper ${paper}`).toHaveLength(modules);
    }
  });

  it('preserves the official order: sections A, B, C... and modules numbered 1..n in sequence', () => {
    for (const s of bundle.subjects) {
      const sections = bundle.sections.filter((x) => x.subject === s.stableKey).sort((a, b) => a.sortOrder - b.sortOrder);
      expect(sections.map((x) => x.officialLabel)).toEqual(sections.map((_, i) => `Section ${String.fromCharCode(65 + i)}`));
      const chapters = chaptersOf(s.stableKey);
      expect(chapters.map((c) => c.officialLabel)).toEqual(chapters.map((_, i) => String(i + 1)));
      // a module sits under the section that precedes it in the official table
      const sectionRank = new Map(sections.map((x) => [x.stableKey, x.sortOrder]));
      const ranks = chapters.map((c) => sectionRank.get(c.section!)!);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it('records the three title differences between the two official documents as documented', () => {
    const title = (key: string) => bundle.chapters.find((c) => c.stableKey === key)?.title;
    // The per-paper PDFs say "Partnership Accounts", "Customs Act" and "Financing Decision of a Firm"; the Full Version
    // says the wording below. See docs/architecture/m5-curriculum-review.md, section 5.
    expect(title('fa-c-partnership-accounting')).toBe('Partnership Accounting');
    expect(bundle.sections.find((s) => s.stableKey === 'fa-s-partnership-accounting')?.title).toBe('Partnership Accounting');
    expect(title('ditx-c-customs-act-and-rules')).toBe('Customs Act & Rules');
    expect(title('fmda-c-financing-decisions-of-a-firm')).toBe('Financing Decisions of a Firm');
  });

  it('every paper section weighting adds up to 100 and agrees with its modules', () => {
    for (const s of bundle.subjects) {
      const sections = bundle.sections.filter((x) => x.subject === s.stableKey);
      const sectionWeights = sections.map((x) => {
        const w = weightOf(x.stableKey).filter((y) => y.level === 'section');
        expect(w, `weightage of section ${x.stableKey}`).toHaveLength(1);
        expect(w[0].minPercent).toBe(w[0].maxPercent);
        return w[0].minPercent;
      });
      expect(sectionWeights.reduce((a, b) => a + b, 0), `paper ${s.paperNumber}`).toBe(100);
    }
  });

  it('records a module weight only where the syllabus gives that module its own, and never invents one', () => {
    const shared = new Set<string>();
    for (const [subject, numbers] of Object.entries(SHARED_WEIGHT)) {
      for (const c of chaptersOf(subject)) if (numbers.includes(Number(c.officialLabel))) shared.add(c.stableKey);
    }
    expect(shared.size).toBe(13);
    const chapterWeights = bundle.weightages.filter((w) => w.level === 'chapter');
    expect(chapterWeights).toHaveLength(74 - 13);
    for (const c of bundle.chapters) {
      const w = weightOf(c.stableKey);
      if (shared.has(c.stableKey)) expect(w, `${c.stableKey} shares a merged weight cell`).toHaveLength(0);
      else {
        expect(w, c.stableKey).toHaveLength(1);
        expect(w[0].minPercent).toBe(w[0].maxPercent);
      }
    }
    // within every section, own module weights plus the shared group (if any) add up to the section weight
    for (const sec of bundle.sections) {
      const mods = bundle.chapters.filter((c) => c.section === sec.stableKey);
      const own = mods.flatMap((c) => weightOf(c.stableKey)).reduce((a, w) => a + w.minPercent, 0);
      const sectionWeight = weightOf(sec.stableKey)[0].minPercent;
      const hasShared = mods.some((c) => shared.has(c.stableKey));
      if (hasShared) expect(own, sec.stableKey).toBeLessThan(sectionWeight);
      else expect(own, sec.stableKey).toBe(sectionWeight);
    }
    expect(bundle.weightages.filter((w) => w.level === 'subject')).toHaveLength(0);
  });

  it('invents nothing: hours, dates and optional fields stay null unless a source states them', () => {
    expect(bundle.chapters.every((c: ChapterDef) => c.suggestedStudyHours === null && c.supersededBy === null)).toBe(true);
    // The syllabus states "effective from June 2023 term of examinations": a term, not a date.
    expect(bundle.meta.syllabus.effectiveFrom).toBeNull();
    expect(bundle.attempts).toHaveLength(1);
    const a = bundle.attempts[0];
    expect([a.label, a.year, a.session, a.examStartDate, a.examEndDate, a.dateStatus]).toEqual(['December 2026', 2026, 'december', '2026-12-10', '2026-12-17', 'official']);
    expect(a.sourceRef).toBe('icmai-exam-timetable-dec-2026');
    expect(bundle.availability).toHaveLength(1);
    expect(bundle.availability[0].attempt).toBe('dec-2026');
  });

  it('cites an official ICMAI source for every record, with the document it came from', () => {
    const records = [bundle.meta.course, bundle.meta.syllabus, bundle.meta.courseSyllabus, ...bundle.attempts, ...bundle.groups, ...bundle.subjects, ...bundle.sections, ...bundle.chapters, ...bundle.weightages, ...bundle.resources];
    const known = new Map(bundle.sources.map((s) => [s.stableKey, s]));
    for (const r of records) expect(known.has(r.sourceRef ?? ''), `source of ${JSON.stringify(r).slice(0, 80)}`).toBe(true);
    for (const s of bundle.sources) {
      expect(s.url, s.stableKey).toMatch(/^https:\/\/(icmai\.in|www\.icmai\.in|dwpivt501gtb6\.cloudfront\.net)\//);
      expect(s.retrievedOn <= TODAY).toBe(true);
    }
    // each module and weightage points at the per-paper syllabus PDF of its own paper
    for (const c of bundle.chapters) {
      const paper = bundle.subjects.find((s) => s.stableKey === c.subject)!.paperNumber;
      expect(c.sourceRef).toBe(`icmai-syllabus-2022-paper-${String(paper).padStart(2, '0')}`);
    }
  });

  it('never claims a human verified a record that is still a draft', () => {
    const records = [bundle.meta.course, bundle.meta.syllabus, bundle.meta.courseSyllabus, ...bundle.attempts, ...bundle.groups, ...bundle.subjects, ...bundle.sections, ...bundle.chapters, ...bundle.weightages, ...bundle.resources];
    for (const r of records) {
      if (r.status === 'draft') expect([r.verifiedAt, r.verifiedBy], JSON.stringify(r).slice(0, 80)).toEqual([null, null]);
      else {
        expect(r.verifiedBy, 'a published record needs a real verifier').toMatch(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/);
        expect(r.verifiedBy).not.toMatch(/test|fake|claude|bot/i);
      }
    }
    for (const a of bundle.availability) if (a.status === 'draft') expect([a.verifiedAt, a.verifiedBy]).toEqual([null, null]);
  });

  it('would pass the publish gate once a reviewer approves (simulated in memory, with a test-only verifier)', () => {
    const copy = load();
    const stamp = (r: { status?: string; verifiedAt?: string | null; verifiedBy?: string | null }) => {
      r.status = 'published';
      r.verifiedAt = TODAY;
      r.verifiedBy = 'test-reviewer';
    };
    [copy.meta.course, copy.meta.syllabus, copy.meta.courseSyllabus, ...copy.attempts, ...copy.groups, ...copy.subjects, ...copy.sections, ...copy.chapters, ...copy.weightages, ...copy.resources].forEach(stamp);
    copy.availability.forEach((a) => Object.assign(a, { status: 'enabled', verifiedAt: TODAY, verifiedBy: 'test-reviewer' }));
    expect(validateBundle(copy, { today: TODAY })).toEqual([]);
  });

  it('stable keys are lower case, unique and never contain the display numbering', () => {
    const keys = [...bundle.groups, ...bundle.subjects, ...bundle.sections, ...bundle.chapters, ...bundle.weightages].map((r) => r.stableKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of bundle.chapters) expect(c.stableKey).toMatch(new RegExp(`^${c.subject}-c-[a-z0-9-]+$`));
    for (const s of bundle.sections) expect(s.stableKey).toMatch(new RegExp(`^${s.subject}-s-[a-z0-9-]+$`));
  });

  it('generates safe, deterministic SQL that touches no personal table and removes nothing', () => {
    const sql = (b: Bundle) => generateSql(b, { contentSha256: hashBundle(b), transaction: true, allowRetireAll: false });
    const a = sql(load());
    expect(a).toBe(sql(load()));
    expect(findUnsafeSql(a)).toEqual([]);
    expect(a).not.toMatch(/\b(delete\s+from|truncate|drop\s+table)\b/i);
  });
});
