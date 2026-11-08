import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A static review of the account code. It cannot prove the code is safe, but it stops the usual mistakes from creeping in:
 * dangerous DOM and code-execution APIs, logging, hand-rolled token storage, and credentials in source.
 */
const ROOT = resolve(__dirname, '../..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
/** Removes comments so the API checks judge code, not prose that happens to mention a word. (URLs inside strings are kept.) */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const SOURCES = [...files(join(ROOT, 'features/auth')), ...files(join(ROOT, 'lib/supabase'))]
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((path) => {
    const raw = readFileSync(path, 'utf8');
    // `text` is the code with comments removed; `raw` keeps everything (for the credential and secret checks).
    return { path: path.replace(`${ROOT}/`, ''), text: stripComments(raw), raw };
  });

describe('account code, reviewed statically', () => {
  it('has files to review', () => expect(SOURCES.length).toBeGreaterThan(15));

  it('never renders or executes untrusted text as markup or code', () => {
    for (const { path, text } of SOURCES) {
      expect(text, path).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|setTimeout\(\s*['"`]/);
    }
  });

  it('does not log (a log line is the easiest way to leak a token, an email or a password)', () => {
    for (const { path, text } of SOURCES) expect(text, path).not.toMatch(/console\.(log|debug|info|warn|error|trace)/);
  });

  it('leaves token storage to the SDK: no direct reads or writes of localStorage, sessionStorage or cookies', () => {
    for (const { path, text } of SOURCES) expect(text, path).not.toMatch(/\b(localStorage|sessionStorage)\b|document\.cookie/);
  });

  it('contains no credential: no project URL, no JWT, no key material', () => {
    for (const { path, raw } of SOURCES) {
      expect(raw, path).not.toMatch(/https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i);
      expect(raw, path).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ/);
      expect(raw, path).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{16,}/);
    }
  });

  it('never mentions a privileged role or key (the secret guard forbids it in browser code, and so does this)', () => {
    for (const { path, raw } of SOURCES) expect(raw, path).not.toMatch(/service[_ -]?role|supabase_admin|SERVICE_KEY/i);
  });

  it('reads configuration only from the three public variables', () => {
    const used = new Set<string>();
    for (const { text } of SOURCES) for (const m of text.matchAll(/VITE_[A-Z0-9_]+/g)) used.add(m[0]);
    expect([...used].sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_AUTH_ENABLED', 'VITE_SUPABASE_URL']);
    for (const name of used) expect(name).not.toMatch(/SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|ADMIN|DATABASE/);
  });

  it('only ever reads the two account tables, and never writes from the browser in this milestone', () => {
    const calls = SOURCES.flatMap(({ path, text }) => [...text.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].map((m) => ({ path, table: m[1] })));
    expect(calls.length).toBeGreaterThan(0);
    for (const { table } of calls) expect(['profiles', 'user_settings']).toContain(table);
    for (const { path, text } of SOURCES) expect(text, path).not.toMatch(/\.(insert|upsert|delete)\s*\(|\.rpc\s*\(|\.storage\b|\.functions\b|\.channel\s*\(/);
    // The only .update( allowed is Supabase Auth's updateUser, which is a different call.
    for (const { path, text } of SOURCES) expect(text.replace(/updateUser/g, ''), path).not.toMatch(/\.update\s*\(/);
  });

  it('never builds a redirect from user input', () => {
    for (const { path, text } of SOURCES) {
      expect(text, path).not.toMatch(/window\.location\.(href|assign|replace)\s*=|location\.(assign|replace)\(/);
    }
  });
});
