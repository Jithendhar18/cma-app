import type {
  Bundle,
  ChapterDef,
  SectionDef,
  ValidationIssue,
  Verification,
  WeightageDef,
} from './types.ts';
import { SCHEMA_VERSION } from './types.ts';

const KEY = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A GitHub-style handle: 1-39 letters, digits or hyphens, not starting with a hyphen. Rules out emails and spaces.
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const HTTPS = /^https:\/\/[^\s]+$/;
// Control characters (including NUL) have no place in curriculum text and would corrupt generated SQL.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface ValidateOptions {
  /** Injected so tests are deterministic. Defaults to the current date. */
  today?: string;
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Validates a merged bundle without touching any database. Returns every problem found; an empty
 * list means the bundle is safe to turn into SQL. This runs locally, in CI, and as the first step of
 * SQL generation.
 */
export function validateBundle(bundle: Bundle, options: ValidateOptions = {}): ValidationIssue[] {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message });

  // ---- shape, keys, text -------------------------------------------------------------------------------
  if (bundle.meta.schemaVersion !== SCHEMA_VERSION) {
    err('meta.schemaVersion', `unsupported schemaVersion ${String(bundle.meta.schemaVersion)} (expected ${SCHEMA_VERSION})`);
  }

  const checkText = (path: string, value: unknown, max = 500) => {
    if (typeof value !== 'string' || value.trim().length === 0) return err(path, 'must be a non-empty string');
    if (value.length > max) err(path, `longer than ${max} characters`);
    if (CONTROL.test(value)) err(path, 'contains a control character');
  };
  const checkOptionalText = (path: string, value: unknown, max = 500) => {
    if (value === null) return;
    checkText(path, value, max);
  };
  const checkKey = (path: string, value: unknown) => {
    if (typeof value !== 'string' || !KEY.test(value) || value.length > 120) {
      err(path, `stableKey must be lower-case letters, digits and . _ - separators (max 120): ${String(value)}`);
    }
  };
  const checkDate = (path: string, value: unknown, allowNull = true) => {
    if (value === null) return allowNull || err(path, 'is required');
    if (typeof value !== 'string' || !isRealDate(value)) return err(path, `not a real YYYY-MM-DD date: ${String(value)}`);
  };
  const checkVerifier = (path: string, value: unknown) => {
    if (value === null) return;
    if (typeof value !== 'string' || !HANDLE.test(value)) {
      err(path, `verifiedBy must be a maintainer handle (letters, digits, hyphens; no spaces or @): ${String(value)}`);
    }
  };
  const checkPositiveInt = (path: string, value: unknown) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 32000) {
      err(path, `must be a positive whole number: ${String(value)}`);
    }
  };

  const unique = <T,>(label: string, items: T[], keyOf: (item: T) => string, pathOf: (i: number) => string) => {
    const seen = new Map<string, number>();
    items.forEach((item, i) => {
      const key = keyOf(item);
      if (seen.has(key)) err(pathOf(i), `duplicate ${label} "${key}" (also at index ${seen.get(key)})`);
      else seen.set(key, i);
    });
  };

  // ---- sources ------------------------------------------------------------------------------------------
  bundle.sources.forEach((s, i) => {
    const p = `sources[${i}]`;
    checkKey(`${p}.stableKey`, s.stableKey);
    checkText(`${p}.title`, s.title);
    checkText(`${p}.documentType`, s.documentType, 100);
    checkOptionalText(`${p}.note`, s.note, 2000);
    if (s.url !== null && !HTTPS.test(s.url)) err(`${p}.url`, `must be an https URL: ${s.url}`);
    checkDate(`${p}.retrievedOn`, s.retrievedOn, false);
    checkDate(`${p}.publishedOn`, s.publishedOn);
    if (typeof s.retrievedOn === 'string' && s.retrievedOn > today) err(`${p}.retrievedOn`, 'is in the future');
  });
  unique('source key', bundle.sources, (s) => s.stableKey, (i) => `sources[${i}].stableKey`);
  const sourceByKey = new Map(bundle.sources.map((s) => [s.stableKey, s]));

  // ---- the publish gate, applied to every record that carries it ---------------------------------------
  const checkVerification = (path: string, v: Verification) => {
    if (v.status !== 'draft' && v.status !== 'published') err(`${path}.status`, `must be "draft" or "published": ${String(v.status)}`);
    if (v.sourceRef !== null && !sourceByKey.has(v.sourceRef)) err(`${path}.sourceRef`, `unknown source "${v.sourceRef}"`);
    checkDate(`${path}.verifiedAt`, v.verifiedAt);
    checkVerifier(`${path}.verifiedBy`, v.verifiedBy);
    if (typeof v.verifiedAt === 'string' && v.verifiedAt > today) err(`${path}.verifiedAt`, 'is in the future');
    if (v.status === 'published') {
      if (v.sourceRef === null) err(`${path}.sourceRef`, 'a published record needs a source reference');
      if (v.verifiedAt === null) err(`${path}.verifiedAt`, 'a published record needs a verification date');
      if (v.verifiedBy === null) err(`${path}.verifiedBy`, 'a published record needs a verifier (verifiedBy)');
      const source = v.sourceRef ? sourceByKey.get(v.sourceRef) : undefined;
      if (source && v.verifiedAt && source.retrievedOn > v.verifiedAt) {
        err(`${path}.verifiedAt`, `verified (${v.verifiedAt}) before its source was retrieved (${source.retrievedOn})`);
      }
    }
  };

  // ---- course, syllabus, CSV -----------------------------------------------------------------------------
  const m = bundle.meta;
  checkKey('meta.bundleKey', m.bundleKey);
  checkText('meta.bundleVersion', m.bundleVersion, 100);
  checkKey('meta.course.stableKey', m.course.stableKey);
  checkText('meta.course.name', m.course.name, 300);
  checkPositiveInt('meta.course.levelOrder', m.course.levelOrder);
  checkVerification('meta.course', m.course);
  checkKey('meta.syllabus.stableKey', m.syllabus.stableKey);
  checkText('meta.syllabus.name', m.syllabus.name, 300);
  checkDate('meta.syllabus.effectiveFrom', m.syllabus.effectiveFrom);
  checkVerification('meta.syllabus', m.syllabus);
  checkVerification('meta.courseSyllabus', m.courseSyllabus);

  // ---- attempts and availability ------------------------------------------------------------------------
  bundle.attempts.forEach((a, i) => {
    const p = `attempts[${i}]`;
    checkKey(`${p}.stableKey`, a.stableKey);
    checkText(`${p}.label`, a.label, 100);
    if (!Number.isInteger(a.year) || a.year < 2000 || a.year > 2100) err(`${p}.year`, `out of range: ${String(a.year)}`);
    if (a.session !== 'june' && a.session !== 'december') err(`${p}.session`, `must be "june" or "december": ${String(a.session)}`);
    checkDate(`${p}.examStartDate`, a.examStartDate);
    checkDate(`${p}.examEndDate`, a.examEndDate);
    if (a.examEndDate !== null && a.examStartDate === null) err(`${p}.examEndDate`, 'an end date needs a start date');
    if (a.examStartDate && a.examEndDate && a.examEndDate < a.examStartDate) err(`${p}.examEndDate`, 'is before the start date');
    if (!['unannounced', 'provisional', 'official'].includes(a.dateStatus)) err(`${p}.dateStatus`, `invalid: ${String(a.dateStatus)}`);
    if (a.dateStatus !== 'unannounced' && a.examStartDate === null) err(`${p}.dateStatus`, `"${a.dateStatus}" requires an exam start date (dates are never invented)`);
    checkVerification(p, a);
  });
  unique('attempt key', bundle.attempts, (a) => a.stableKey, (i) => `attempts[${i}].stableKey`);
  unique('attempt (year, session)', bundle.attempts, (a) => `${a.year}-${a.session}`, (i) => `attempts[${i}]`);
  const attemptByKey = new Map(bundle.attempts.map((a) => [a.stableKey, a]));

  bundle.availability.forEach((a, i) => {
    const p = `availability[${i}]`;
    if (!attemptByKey.has(a.attempt)) err(`${p}.attempt`, `unknown attempt "${a.attempt}"`);
    if (!['draft', 'enabled', 'disabled'].includes(a.status)) err(`${p}.status`, `invalid: ${String(a.status)}`);
    if (a.sourceRef !== null && !sourceByKey.has(a.sourceRef)) err(`${p}.sourceRef`, `unknown source "${a.sourceRef}"`);
    checkDate(`${p}.verifiedAt`, a.verifiedAt);
    checkVerifier(`${p}.verifiedBy`, a.verifiedBy);
    if (a.status === 'enabled') {
      if (a.sourceRef === null || a.verifiedAt === null || a.verifiedBy === null) {
        err(p, 'an enabled attempt needs a source reference, a verification date and a verifier');
      }
      if (attemptByKey.get(a.attempt)?.status !== 'published') err(`${p}.attempt`, 'cannot enable an attempt that is not published');
      if (m.courseSyllabus.status !== 'published') err(p, 'cannot enable an attempt for a course and syllabus that is not published');
    }
  });
  unique('availability attempt', bundle.availability, (a) => a.attempt, (i) => `availability[${i}].attempt`);

  // ---- groups ------------------------------------------------------------------------------------------------------
  bundle.groups.forEach((g, i) => {
    const p = `groups[${i}]`;
    checkKey(`${p}.stableKey`, g.stableKey);
    checkText(`${p}.name`, g.name, 200);
    checkPositiveInt(`${p}.sortOrder`, g.sortOrder);
    checkVerification(p, g);
  });
  unique('group key', bundle.groups, (g) => g.stableKey, (i) => `groups[${i}].stableKey`);
  const groupKeys = new Set(bundle.groups.map((g) => g.stableKey));
  checkContiguous('groups', bundle.groups.map((g) => g.sortOrder), 'sortOrder', err);

  // ---- subjects -------------------------------------------------------------------------------------------------
  bundle.subjects.forEach((s, i) => {
    const p = `subjects[${i}]`;
    checkKey(`${p}.stableKey`, s.stableKey);
    if (typeof s.slug !== 'string' || !SLUG.test(s.slug) || s.slug.length > 80) err(`${p}.slug`, `must be a url slug (lower case, digits, hyphens): ${String(s.slug)}`);
    checkText(`${p}.name`, s.name, 300);
    checkText(`${p}.shortName`, s.shortName, 100);
    checkPositiveInt(`${p}.paperNumber`, s.paperNumber);
    checkPositiveInt(`${p}.sortOrder`, s.sortOrder);
    if (!groupKeys.has(s.group)) err(`${p}.group`, `unknown group "${s.group}"`);
    checkVerification(p, s);
  });
  unique('subject key', bundle.subjects, (s) => s.stableKey, (i) => `subjects[${i}].stableKey`);
  unique('subject slug', bundle.subjects, (s) => s.slug, (i) => `subjects[${i}].slug`);
  unique('paper number', bundle.subjects, (s) => String(s.paperNumber), (i) => `subjects[${i}].paperNumber`);
  const subjectKeys = new Set(bundle.subjects.map((s) => s.stableKey));
  for (const g of bundle.groups) {
    checkContiguous(`subjects in group ${g.stableKey}`, bundle.subjects.filter((s) => s.group === g.stableKey).map((s) => s.sortOrder), 'sortOrder', err);
  }

  // ---- sections -------------------------------------------------------------------------------------------------
  const sectionByKey = new Map<string, SectionDef>(bundle.sections.map((s) => [s.stableKey, s]));
  bundle.sections.forEach((s, i) => {
    const p = `sections[${i}]`;
    checkKey(`${p}.stableKey`, s.stableKey);
    checkText(`${p}.title`, s.title);
    checkOptionalText(`${p}.officialLabel`, s.officialLabel, 200);
    checkPositiveInt(`${p}.sortOrder`, s.sortOrder);
    if (!subjectKeys.has(s.subject)) err(`${p}.subject`, `unknown subject "${s.subject}"`);
    if (s.parent !== null) {
      const parent = sectionByKey.get(s.parent);
      if (!parent) err(`${p}.parent`, `unknown parent section "${s.parent}"`);
      else if (parent.subject !== s.subject) err(`${p}.parent`, 'a parent section must belong to the same subject');
    }
    checkVerification(p, s);
  });
  unique('section key', bundle.sections, (s) => s.stableKey, (i) => `sections[${i}].stableKey`);
  bundle.sections.forEach((s, i) => {
    // cycle check: walk the parent chain
    const seen = new Set<string>([s.stableKey]);
    let cursor = s.parent;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        err(`sections[${i}].parent`, 'section hierarchy contains a cycle');
        break;
      }
      seen.add(cursor);
      cursor = sectionByKey.get(cursor)?.parent ?? null;
    }
  });
  const siblingGroups = new Map<string, number[]>();
  for (const s of bundle.sections) {
    const k = `${s.subject}/${s.parent ?? '(top)'}`;
    siblingGroups.set(k, [...(siblingGroups.get(k) ?? []), s.sortOrder]);
  }
  siblingGroups.forEach((orders, k) => checkContiguous(`sections under ${k}`, orders, 'sortOrder', err));

  // ---- chapters ---------------------------------------------------------------------------------------------------
  const chapterByKey = new Map<string, ChapterDef>(bundle.chapters.map((c) => [c.stableKey, c]));
  bundle.chapters.forEach((c, i) => {
    const p = `chapters[${i}]`;
    checkKey(`${p}.stableKey`, c.stableKey);
    checkText(`${p}.title`, c.title);
    checkOptionalText(`${p}.officialLabel`, c.officialLabel, 200);
    checkPositiveInt(`${p}.sequenceNo`, c.sequenceNo);
    if (c.suggestedStudyHours !== null && (typeof c.suggestedStudyHours !== 'number' || !(c.suggestedStudyHours > 0) || c.suggestedStudyHours > 999)) {
      err(`${p}.suggestedStudyHours`, 'must be null or a positive number');
    }
    if (!subjectKeys.has(c.subject)) err(`${p}.subject`, `unknown subject "${c.subject}"`);
    if (c.section !== null) {
      const section = sectionByKey.get(c.section);
      if (!section) err(`${p}.section`, `unknown section "${c.section}"`);
      else if (section.subject !== c.subject) err(`${p}.section`, 'a chapter\'s section must belong to the same subject');
    }
    if (c.supersededBy !== null) {
      if (c.supersededBy === c.stableKey) err(`${p}.supersededBy`, 'a chapter cannot supersede itself');
      else if (!chapterByKey.has(c.supersededBy)) err(`${p}.supersededBy`, `unknown chapter "${c.supersededBy}"`);
    }
    checkVerification(p, c);
  });
  unique('chapter key', bundle.chapters, (c) => c.stableKey, (i) => `chapters[${i}].stableKey`);
  for (const s of bundle.subjects) {
    checkContiguous(`chapters in subject ${s.stableKey}`, bundle.chapters.filter((c) => c.subject === s.stableKey).map((c) => c.sequenceNo), 'sequenceNo', err);
  }

  // ---- weightages ---------------------------------------------------------------------------------------------------
  const targetExists = (w: WeightageDef) =>
    w.level === 'subject' ? subjectKeys.has(w.target) : w.level === 'section' ? sectionByKey.has(w.target) : chapterByKey.has(w.target);
  bundle.weightages.forEach((w, i) => {
    const p = `weightages[${i}]`;
    checkKey(`${p}.stableKey`, w.stableKey);
    checkText(`${p}.publishedLabel`, w.publishedLabel, 300);
    if (!['subject', 'section', 'chapter'].includes(w.level)) err(`${p}.level`, `invalid: ${String(w.level)}`);
    else if (!targetExists(w)) err(`${p}.target`, `no ${w.level} "${w.target}" in this bundle`);
    if (typeof w.minPercent !== 'number' || typeof w.maxPercent !== 'number' || w.minPercent < 0 || w.maxPercent > 100 || w.minPercent > w.maxPercent) {
      err(`${p}`, `percentages must satisfy 0 <= min <= max <= 100 (got ${String(w.minPercent)}..${String(w.maxPercent)})`);
    }
    // A weightage always needs a source, even as a draft: it is a published fact or it is nothing.
    if (w.sourceRef === null) err(`${p}.sourceRef`, 'every weightage needs the source that published it');
    checkVerification(p, w);
  });
  unique('weightage key', bundle.weightages, (w) => w.stableKey, (i) => `weightages[${i}].stableKey`);
  unique('weightage target', bundle.weightages, (w) => `${w.level}:${w.target}:${w.sourceRef ?? ''}`, (i) => `weightages[${i}]`);

  // Never derive chapter weightages from a section. A chapter value identical to its parent section's value,
  // from the same source, under a section that has several chapters, looks like a percentage spread downwards.
  bundle.weightages.filter((w) => w.level === 'chapter').forEach((w) => {
    const chapter = chapterByKey.get(w.target);
    const parentKey = chapter?.section ?? null;
    if (!chapter || parentKey === null) return;
    const sibling = bundle.chapters.filter((c) => c.section === parentKey).length;
    const parentWeightage = bundle.weightages.find((x) => x.level === 'section' && x.target === parentKey && x.sourceRef === w.sourceRef);
    if (parentWeightage && sibling > 1 && parentWeightage.minPercent === w.minPercent && parentWeightage.maxPercent === w.maxPercent) {
      err(`weightages[${bundle.weightages.indexOf(w)}]`, 'chapter weightage equals its section weightage from the same source: do not spread section percentages onto chapters');
    }
  });

  // ---- resources -----------------------------------------------------------------------------------------------------
  bundle.resources.forEach((r, i) => {
    const p = `resources[${i}]`;
    checkKey(`${p}.stableKey`, r.stableKey);
    checkText(`${p}.title`, r.title);
    checkText(`${p}.publisher`, r.publisher, 200);
    if (typeof r.url !== 'string' || !HTTPS.test(r.url) || r.url.length > 2000) err(`${p}.url`, `must be an https URL: ${String(r.url)}`);
    if (!['study_material', 'mcq_bank', 'model_question_paper', 'previous_question_paper', 'notice', 'timetable', 'other'].includes(r.resourceType)) {
      err(`${p}.resourceType`, `invalid: ${String(r.resourceType)}`);
    }
    if (!['active', 'broken', 'retired'].includes(r.linkStatus)) err(`${p}.linkStatus`, `invalid: ${String(r.linkStatus)}`);
    if (typeof r.isOfficial !== 'boolean') err(`${p}.isOfficial`, 'must be true or false');
    if (r.year !== null && (!Number.isInteger(r.year) || r.year < 2000 || r.year > 2100)) err(`${p}.year`, `out of range: ${String(r.year)}`);
    if (r.session !== null && r.session !== 'june' && r.session !== 'december') err(`${p}.session`, `invalid: ${String(r.session)}`);
    checkDate(`${p}.lastCheckedAt`, r.lastCheckedAt);
    if (r.scope.subject !== null && !subjectKeys.has(r.scope.subject)) err(`${p}.scope.subject`, `unknown subject "${r.scope.subject}"`);
    if (r.scope.chapter !== null && !chapterByKey.has(r.scope.chapter)) err(`${p}.scope.chapter`, `unknown chapter "${r.scope.chapter}"`);
    if (r.scope.attempt !== null && !attemptByKey.has(r.scope.attempt)) err(`${p}.scope.attempt`, `unknown attempt "${r.scope.attempt}"`);
    checkVerification(p, r);
  });
  unique('resource key', bundle.resources, (r) => r.stableKey, (i) => `resources[${i}].stableKey`);
  unique(
    'resource (type, url, scope)',
    bundle.resources,
    (r) => [r.resourceType, r.url, r.scope.subject ?? '', r.scope.chapter ?? ''].join('|'),
    (i) => `resources[${i}]`,
  );

  // ---- readiness: mirrors csv_is_ready() in the database ----------------------------------------------------------------
  if (m.courseSyllabus.status === 'published') {
    if (m.course.status !== 'published') err('meta.course.status', 'the CSV is published, so the course must be published too');
    if (m.syllabus.status !== 'published') err('meta.syllabus.status', 'the CSV is published, so the syllabus version must be published too');
    const publishedGroups = bundle.groups.filter((g) => g.status === 'published');
    if (publishedGroups.length === 0) err('groups', 'a published bundle needs at least one published group (it would otherwise retire everything)');
    for (const g of publishedGroups) {
      if (!bundle.subjects.some((s) => s.group === g.stableKey && s.status === 'published')) {
        err(`groups[${bundle.groups.indexOf(g)}]`, `published group "${g.stableKey}" has no published subject`);
      }
    }
    for (const s of bundle.subjects.filter((x) => x.status === 'published')) {
      if (!bundle.chapters.some((c) => c.subject === s.stableKey && c.status === 'published')) {
        err(`subjects[${bundle.subjects.indexOf(s)}]`, `published subject "${s.stableKey}" has no published chapter`);
      }
    }
  }

  return issues;
}

/** Positions must be 1..n with no gaps and no repeats, which preserves the official order exactly. */
function checkContiguous(
  label: string,
  orders: number[],
  field: string,
  err: (path: string, message: string) => void,
): void {
  if (orders.length === 0) return;
  const sorted = [...orders].sort((a, b) => a - b);
  const ok = sorted.every((value, i) => value === i + 1);
  if (!ok) err(label, `${field} values must be exactly 1..${orders.length} with no gaps or repeats (got ${sorted.join(', ')})`);
}
