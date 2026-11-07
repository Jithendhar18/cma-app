import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashBundle, loadBundle } from './bundle-io.ts';
import { findUnsafeSql, generateSql, lit, PERSONAL_TABLES } from './generate-sql.ts';
import type { Bundle } from './types.ts';
import { validateBundle } from './validate.ts';

const ROOT = resolve(__dirname, '../..');
const FIXTURE = resolve(__dirname, '__fixtures__/fake-bundle');
const HASH = 'a'.repeat(64);
const load = (): Bundle => loadBundle(resolve(FIXTURE, 'bundle'), resolve(FIXTURE, 'shared'));
const sqlOf = (b: Bundle = load(), transaction = true) => generateSql(b, { contentSha256: HASH, transaction });

describe('generateSql', () => {
  it('generates SQL only for a bundle that validates', () => {
    expect(validateBundle(load(), { today: '2026-11-08' })).toEqual([]);
    expect(sqlOf().length).toBeGreaterThan(1000);
  });

  it('is deterministic: identical input gives identical bytes', () => {
    expect(sqlOf()).toBe(sqlOf());
    const shuffled = load();
    shuffled.chapters.reverse();
    shuffled.subjects.reverse();
    shuffled.resources.reverse();
    expect(sqlOf(shuffled)).toBe(sqlOf());
  });

  it('wraps in a transaction by default and can be unwrapped for tests', () => {
    expect(sqlOf()).toMatch(/^begin;$/m);
    expect(sqlOf()).toMatch(/^commit;$/m);
    expect(sqlOf(load(), false)).not.toMatch(/^(begin|commit);$/m);
  });

  it('rejects a malformed content hash', () => {
    expect(() => generateSql(load(), { contentSha256: 'nope' })).toThrow(/64 character/);
  });

  it('never contains a destructive or privileged statement and never touches student tables', () => {
    expect(findUnsafeSql(sqlOf())).toEqual([]);
    expect(sqlOf()).not.toMatch(/\bdelete\b/i);
    expect(sqlOf()).not.toMatch(/\btruncate\b/i);
    expect(sqlOf()).not.toMatch(/\bdrop\b/i);
    for (const table of PERSONAL_TABLES) expect(sqlOf()).not.toMatch(new RegExp(`\\b${table}\\b`));
  });

  it('retires rows the bundle no longer lists, per table, scoped to this CSV', () => {
    const sql = sqlOf();
    for (const table of ['subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources']) {
      expect(sql).toMatch(new RegExp(`update public\\.${table} set status = 'retired'\\s+where csv_id = \\(select id from public\\.course_syllabus_versions where stable_key = 'fake-course\\.fake-syllabus'\\)`));
    }
    expect(sql).toContain(`stable_key::text <> all (array['fake-ch-1', 'fake-ch-2', 'fake-ch-3', 'fake-ch-4', 'fake-ch-5']::text[])`);
  });

  it('never downgrades a published row and never erases a recorded verification', () => {
    const sql = sqlOf();
    expect(sql).toContain(`status = case when excluded.status = 'published' then 'published' else public.chapters.status end`);
    expect(sql).toContain('verified_at = coalesce(excluded.verified_at, public.chapters.verified_at)');
    expect(sql).toContain('source_reference_id = coalesce(excluded.source_reference_id, public.chapters.source_reference_id)');
  });

  it('inserts the CSV and availability as draft and promotes them only at the end', () => {
    const sql = sqlOf();
    const csvInsert = sql.indexOf("select 'fake-course.fake-syllabus', c.id, s.id, 'draft'");
    const chapters = sql.indexOf('insert into public.chapters');
    const retire = sql.indexOf("update public.chapters set status = 'retired'");
    const promoteCsv = sql.indexOf("update public.course_syllabus_versions set status = 'published'");
    const enable = sql.indexOf("update public.course_attempt_availability set status = 'enabled'");
    const audit = sql.indexOf('insert into public.curriculum_import_batches');
    expect(csvInsert).toBeGreaterThan(-1);
    expect(csvInsert).toBeLessThan(chapters);
    expect(chapters).toBeLessThan(retire);
    expect(retire).toBeLessThan(promoteCsv);
    expect(promoteCsv).toBeLessThan(enable);
    expect(enable).toBeLessThan(audit);
    expect(sql).toMatch(/insert into public\.course_attempt_availability[\s\S]*?'draft'/);
  });

  it('does not promote a CSV the bundle keeps as draft', () => {
    const b = load();
    b.meta.courseSyllabus.status = 'draft';
    b.availability = [];
    expect(sqlOf(b)).not.toContain("update public.course_syllabus_versions set status = 'published'");
  });

  it('orders inserts by dependency, parents before children', () => {
    const sql = sqlOf();
    const order = ['source_references', 'courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources'].map((t) => sql.indexOf(`insert into public.${t} `));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql.indexOf("'fake-section-a',")).toBeLessThan(sql.indexOf("'fake-section-a1',"));
  });

  it('writes the audit record last, so a failed import is never logged', () => {
    const sql = sqlOf();
    const lastInsert = sql.lastIndexOf('insert into');
    expect(sql.slice(lastInsert)).toContain('curriculum_import_batches');
    expect(sql).toContain(`on conflict (bundle_key, content_sha256) do nothing`);
  });

  it('uses stable keys for every lookup, never a database id', () => {
    const sql = sqlOf();
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(sql).toContain("stable_key = 'fake-course.fake-syllabus'");
  });

  it('stores each weightage at its own level only', () => {
    const sql = sqlOf();
    expect(sql).toMatch(/insert into public\.official_weightages \(csv_id, stable_key, level, section_id,/);
    expect(sql).not.toMatch(/official_weightages \(csv_id, stable_key, level, chapter_id/);
  });
});

describe('verified_by (S7)', () => {
  it('writes the verifier for every publishable table', () => {
    const sql = sqlOf();
    for (const table of ['courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources', 'course_attempt_availability']) {
      const insert = new RegExp(`insert into public\\.${table} \\([^)]*verified_by`);
      expect(sql, table).toMatch(insert);
    }
    expect(sql).toContain("'fake-maintainer'");
  });

  it('preserves an existing verifier in an ordinary import and replaces it only when verification is repeated', () => {
    const sql = sqlOf();
    expect(sql).toContain('verified_by = coalesce(excluded.verified_by, public.chapters.verified_by)');
    // A draft entry carries no verifier, so coalesce keeps whatever is recorded.
    const draft = load();
    draft.chapters[0].status = 'draft';
    draft.chapters[0].verifiedBy = null;
    expect(sqlOf(draft)).toContain("null, (select id from public.source_references") ;
  });
});

describe('retire-all guard (S11)', () => {
  const guardOf = (allow: boolean) => {
    const sql = generateSql(load(), { contentSha256: HASH, transaction: false, allowRetireAll: allow });
    return sql.slice(sql.indexOf('do $guard$'), sql.indexOf('$guard$;') + '$guard$;'.length);
  };

  it('is present by default and aborts naming the scope, the count and the escape hatch', () => {
    const guard = guardOf(false);
    expect(guard).toContain('raise exception');
    expect(guard).toContain('import would retire ALL % active record(s) in scope');
    expect(guard).toContain('--allow-retire-all');
    expect(guard).toContain('nothing was changed');
    expect(guard).not.toContain('raise notice');
  });

  it('covers every scope', () => {
    const guard = guardOf(false);
    for (const label of ['subject groups', 'subjects', 'sections', 'chapters', 'weightages', 'resources']) {
      expect(guard).toContain(`scope "${label}"`);
    }
  });

  it('announces instead of aborting when overridden, still naming scope and count', () => {
    const guard = guardOf(true);
    expect(guard).not.toContain('raise exception');
    expect(guard).toContain('raise notice');
    expect(guard).toContain('retire-all ALLOWED');
    expect(guard).toContain('in scope "chapters"');
    expect(sqlOf(load())).not.toContain('retire-all ALLOWED');
  });

  it('runs before any statement that changes data, so it sees only what existed before the import', () => {
    for (const allow of [false, true]) {
      const sql = generateSql(load(), { contentSha256: HASH, transaction: false, allowRetireAll: allow });
      const guard = sql.indexOf('do $guard$');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(sql.indexOf('insert into public.source_references'));
      expect(guard).toBeLessThan(sql.indexOf('insert into public.chapters'));
      expect(guard).toBeLessThan(sql.indexOf("set status = 'retired'"));
    }
  });

  it('only counts rows that are not already retired, within this bundle\'s CSV', () => {
    const guard = guardOf(false);
    expect(guard).toContain("status <> 'retired'");
    expect(guard).toContain("scope_csv uuid := (select id from public.course_syllabus_versions where stable_key = 'fake-course.fake-syllabus')");
  });

  it('keeps the override a separate, deliberate input: the bundle itself can never switch it on', () => {
    expect(JSON.stringify(load())).not.toMatch(/allowRetireAll|allow-retire-all/);
    expect(sqlOf()).not.toContain('retire-all ALLOWED');
  });

  it('stays safe SQL in both modes', () => {
    expect(findUnsafeSql(generateSql(load(), { contentSha256: HASH, allowRetireAll: true }))).toEqual([]);
    expect(findUnsafeSql(generateSql(load(), { contentSha256: HASH, allowRetireAll: false }))).toEqual([]);
  });

  it('is deterministic in both modes', () => {
    expect(guardOf(false)).toBe(guardOf(false));
    expect(guardOf(true)).toBe(guardOf(true));
    expect(guardOf(true)).not.toBe(guardOf(false));
  });
});

describe('SQL escaping', () => {
  it('doubles single quotes', () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
    expect(lit("''")).toBe("''''''");
  });

  it('keeps an injection attempt inert inside a literal', () => {
    const b = load();
    b.chapters[0].title = "x'); drop table public.courses; --";
    const sql = sqlOf(b);
    expect(sql).toContain("'x''); drop table public.courses; --'");
    // outside literals there is still nothing unsafe
    expect(findUnsafeSql(sql)).toEqual([]);
  });

  it('survives unicode, backslashes and newlines in text', () => {
    const b = load();
    b.chapters[0].title = 'Rs ₹ \\ back “slash” and unicode';
    expect(sqlOf(b)).toContain('Rs ₹ \\ back “slash” and unicode');
  });
});

describe('findUnsafeSql', () => {
  it.each([
    ['delete', "delete from public.chapters where true;", 'no DELETE'],
    ['truncate', 'truncate public.chapters;', 'no TRUNCATE'],
    ['drop table', 'drop table public.chapters;', 'no DROP'],
    ['drop trigger', 'drop trigger x on public.chapters;', 'no DROP'],
    ['alter table', 'alter table public.chapters add column x int;', 'no ALTER TABLE'],
    ['grant', 'grant select on public.chapters to anon;', 'no GRANT or REVOKE'],
    ['revoke', 'revoke all on public.chapters from anon;', 'no GRANT or REVOKE'],
    ['rls', 'alter table public.chapters disable row level security;', 'no RLS changes'],
    ['auth schema', 'update auth.users set email = 1;', 'no auth schema access'],
    ['create function', 'create function f() returns int as $$ select 1 $$;', 'no CREATE statements'],
  ])('flags %s', (_label, sql, rule) => {
    expect(findUnsafeSql(sql).map((i) => i.rule)).toContain(rule);
  });

  it.each(PERSONAL_TABLES.map((t) => [t]))('flags a reference to the student table %s', (table) => {
    expect(findUnsafeSql(`select * from public.${table};`).map((i) => i.rule)).toContain(`must not reference personal table ${table}`);
  });

  it('ignores dangerous words inside string literals and comments', () => {
    expect(findUnsafeSql("insert into public.chapters (title) values ('delete from x; drop table y; profiles');")).toEqual([]);
    expect(findUnsafeSql('-- delete from everything\nselect 1;')).toEqual([]);
  });
});

describe('hashing', () => {
  it('is stable regardless of key order and changes with content', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
    const a = load();
    expect(hashBundle(a)).toBe(hashBundle(load()));
    expect(hashBundle(a)).toMatch(/^[0-9a-f]{64}$/);
    const changed = load();
    changed.chapters[0].title = 'FAKE Chapter 1 (edited)';
    expect(hashBundle(changed)).not.toBe(hashBundle(a));
  });
});

describe('the fixture never reaches the student-facing dataset', () => {
  const migrationsDir = resolve(ROOT, 'supabase/migrations');
  const files = [
    ...readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).map((f) => resolve(migrationsDir, f)),
    resolve(ROOT, 'supabase/seed.sql'),
  ];

  it.each(files.map((f) => [f.replace(`${ROOT}/`, ''), f]))('%s contains no fake fixture content', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/fake-/i);
    expect(text).not.toMatch(/\bFAKE\b/);
    expect(text).not.toMatch(/example\.invalid/);
  });

  it('migrations insert no rows into curriculum tables', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
      expect(text, file).not.toMatch(/insert\s+into\s+public\.(courses|syllabus_versions|course_syllabus_versions|exam_attempts|subjects|chapters|study_resources|source_references)/i);
    }
  });

  it('the seed file is empty of statements', () => {
    const seed = readFileSync(resolve(ROOT, 'supabase/seed.sql'), 'utf8').replace(/--[^\n]*/g, '').trim();
    expect(seed).toBe('');
  });
});
