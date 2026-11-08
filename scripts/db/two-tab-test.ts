/// <reference lib="dom" />
/**
 * Two REAL browser pages, one origin, one signed-in account, the local Supabase stack.
 *
 *   bash scripts/db/test-two-tab.sh            the scenario must pass
 *   bash scripts/db/test-two-tab.sh --mutate   the same scenario against copies of the app with a protection removed: it must FAIL
 *
 * Scenario: both pages are signed in to the same account and bound to its enrolment; the second page queues a legitimate change that
 * cannot be sent; the first page signs out; the second page receives the sign-out through the browser's own storage/broadcast events.
 * Then: its stores unbound before the local data came back, no local sample data reached the account's outbox (or its set-aside or conflict
 * logs), no sync request happened after unbinding, the three local-mode keys are byte-for-byte unchanged, and the account's outbox kept the
 * pending change.
 *
 * Local only: it refuses any non-local API or database. It installs the clearly-FAKE curriculum fixture, removes it afterwards, and refuses to
 * start unless every shared curriculum table is empty. Chrome is driven with playwright-core (a dev dependency); set CHROME_PATH to override.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');
const URL = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
const MUTATE = process.argv.includes('--mutate-run') ? (process.argv[process.argv.indexOf('--mutate-run') + 1] as 'ordering' | 'guard') : null;
const PORT = Number(process.env.TWO_TAB_PORT ?? 4173);
const RUN = Math.random().toString(36).slice(2, 8);
const EMAIL = `m8-tab-${RUN}@example.test`;
const PASSWORD = 'correct horse battery';
const LOCAL_KEYS = ['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui'];
const SHARED = ['courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts', 'course_attempt_availability', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources', 'source_references', 'curriculum_import_batches'];

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) { console.error(`REFUSED: local stack only (SUPABASE_URL=${URL || 'unset'})`); process.exit(2); }
if (!KEY) { console.error('no local anon key'); process.exit(2); }

const pgEnv = { ...process.env, PGHOST: '127.0.0.1', PGPORT: process.env.PGPORT ?? '54322', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: 'postgres' };
const psql = (sql: string) => execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: pgEnv, encoding: 'utf8' }).trim();
const sharedRows = () => Number(psql(`select ${SHARED.map((t) => `(select count(*) from public.${t})`).join(' + ')}`));

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};

// ---- the app under test (built for this local stack; the anon key is public) ----------------------------------------------------
function prepareApp(mutation: 'ordering' | 'guard' | null): { dir: string; cleanup: () => void } {
  let dir = ROOT;
  let cleanup: () => void = () => undefined;
  if (mutation) {
    dir = mkdtempSync(join(tmpdir(), 'cma-mutant-'));
    for (const item of ['src', 'public', 'index.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']) if (existsSync(join(ROOT, item))) cpSync(join(ROOT, item), join(dir, item), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    const patch = (file: string, from: string, to: string) => {
      const path = join(dir, file);
      const text = readFileSync(path, 'utf8');
      if (!text.includes(from)) throw new Error(`mutation target not found in ${file}: the test would prove nothing`);
      writeFileSync(path, text.replace(from, to));
    };
    if (mutation === 'ordering') patch('src/lib/account/storeSwap.ts', "  mode = { kind: 'local' };\n\n  // 1. Point back at the local keys", "\n  // 1. Point back at the local keys");
    if (mutation === 'guard') patch('src/features/sync/SyncProvider.tsx', "return m.kind === 'account' && m.userId === userId && m.enrollmentId === enrollmentId;", 'void m; return true;');
    cleanup = () => rmSync(dir, { recursive: true, force: true });
  }
  const out = join(dir, 'dist-twotab');
  const dispose = cleanup;
  cleanup = () => { dispose(); rmSync(out, { recursive: true, force: true }); };
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: dir, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_AUTH_ENABLED: 'true', VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: KEY } });
  return { dir, cleanup };
}

async function serve(dir: string): Promise<ChildProcess> {
  const child = spawn('npx', ['vite', 'preview', '--outDir', 'dist-twotab', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('the preview server did not start');
}

// ---- the account and its enrolment (set up over the local API, as a student would) ---------------------------------------------
async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const res = await fetch(`${URL}${path}`, { ...init, headers: { apikey: KEY, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) } });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

async function createAccount(): Promise<string> {
  const signUp = await api('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD, data: { display_name: 'Two Tab' } }) });
  const id = String(signUp.body?.id ?? signUp.body?.user?.id ?? '');
  if (!id) throw new Error('could not create the test account');
  psql(`update auth.users set email_confirmed_at = now() where id = '${id}'`);
  const login = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const token = String(login.body?.access_token ?? '');
  if (!token) throw new Error('could not sign in the test account');
  const csv = psql(`select id from public.course_syllabus_versions where stable_key = 'fake-csv-1'`);
  const attempt = psql(`select id from public.exam_attempts where stable_key = 'fake-attempt-a'`);
  const group = psql(`select id from public.subject_groups where stable_key = 'fake-group-1'`);
  const enrol = await api('/rest/v1/rpc/create_enrollment', { method: 'POST', token, body: JSON.stringify({ p_csv_id: csv, p_attempt_id: attempt, p_group_ids: [group], p_replace_active: false }) });
  if (!enrol.ok) throw new Error(`could not enrol the test account (${enrol.status})`);
  const done = await api(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', token, body: JSON.stringify({ onboarding_completed_at: new Date().toISOString() }) });
  if (!done.ok) throw new Error('could not finish onboarding for the test account');
  return id;
}

const chip = (page: Page, name: string | RegExp) => page.getByRole('button', { name: typeof name === 'string' ? `Sync status: ${name}` : name });
const goInApp = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
const readKeys = (page: Page, keys: string[]) => page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);

function chromePath(): string {
  const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error('no Chrome found; set CHROME_PATH');
  return found;
}

async function scenario(userId: string, base: string): Promise<void> {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  let ctx: BrowserContext | null = null;
  try {
    ctx = await browser.newContext(); // one context = one origin's storage, shared by every page in it, like two tabs
    await ctx.addInitScript(() => {
      const w = window as unknown as { __leaks: string[] };
      w.__leaks = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        // the sample curriculum's ids (p5-1, ...) must never appear in anything the sync layer keeps
        if (key.startsWith('cma-sync-') && String(value).includes('p5-')) w.__leaks.push(key);
        return original.call(this, key, value);
      };
    });
    const requests: Array<{ at: number; url: string; page: string }> = [];
    // Sync requests are the ones the sync engine makes: the personal tables and the account's own rows. (A read of the shared course list that was
    // already in flight is retried by the client library for a few seconds on its own; that is not the sync engine and is not counted.)
    const SYNC = /\/rest\/v1\/(chapter_progress|planner_sessions|study_sessions|revisions|practice_records|mock_tests|profiles|user_settings|student_enrollments)\b/;
    ctx.on('request', (r) => { if (SYNC.test(r.url())) requests.push({ at: Date.now(), url: r.url(), page: r.frame()?.url() ?? '?' }); });

    // 1. both pages sign in to the same account (the second one through the shared session)
    const one = await ctx.newPage();
    await one.goto(`${base}/auth/sign-in`);
    await one.getByLabel('Email').fill(EMAIL);
    await one.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await one.getByRole('button', { name: 'Sign in', exact: true }).click();
    await chip(one, 'Synced').waitFor({ timeout: 30_000 });
    const two = await ctx.newPage();
    await two.goto(`${base}/`);
    await chip(two, 'Synced').waitFor({ timeout: 30_000 });

    // 2. both are bound to the account's data (its own per-user keys exist, and the chip only exists while bound)
    const studyKey = `cma-study-os:${userId}`;
    check('page one is bound to the account', (await one.evaluate((k) => localStorage.getItem(k), studyKey)) !== null);
    check('page two is bound to the account', (await two.evaluate((k) => localStorage.getItem(k), studyKey)) !== null);
    const localBefore = await readKeys(one, LOCAL_KEYS);

    // 3. page two queues a legitimate change that cannot be sent (the data API is made unreachable for the whole browser)
    await ctx.route('**/rest/v1/**', (route) => route.abort('failed'));
    await goInApp(two, '/settings');
    await two.getByLabel('Name', { exact: true }).fill('Two Tab Name');
    await two.getByRole('button', { name: 'Save profile' }).click();
    await chip(two, /Sync status: Offline \(\d+ pending\)/).waitFor({ timeout: 20_000 });
    const outboxKey = `cma-sync-outbox:${userId}`;
    check('the change is queued on disk', ((await two.evaluate((k) => localStorage.getItem(k), outboxKey)) ?? '').includes('profiles:self'));

    // 4. page one signs out; it cannot save the pending change, so it asks, and the student signs out anyway
    await goInApp(one, '/account');
    await one.getByRole('button', { name: 'Sign out', exact: true }).click();
    await one.getByText(/not been saved to your account yet/).waitFor({ timeout: 20_000 });
    check('signing out with unsaved changes asks first', true);
    await one.getByRole('button', { name: 'Sign out anyway' }).click();

    // 5. page two receives the sign-out through the browser's own events, and 6. unbinds
    await chip(two, /Sync status/).waitFor({ state: 'detached', timeout: 30_000 });
    await chip(one, /Sync status/).waitFor({ state: 'detached', timeout: 30_000 });
    check('page two received the sign-out and left the account', true);
    check('the session is gone from the shared storage', (await two.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token/.test(k)))).length === 0);

    // 8. nothing more is sent once unbound
    const tUnbound = Date.now();
    await new Promise((r) => setTimeout(r, 1500));
    const settled = requests.length;
    await new Promise((r) => setTimeout(r, 5000));
    check('no sync request after unbinding', requests.length === settled, `${requests.slice(settled).map((r) => `${r.url.replace(URL, '').slice(0, 60)} from ${r.page} at +${r.at - tUnbound}ms`).join(', ')}`);

    // 7. no local sample data entered anything the sync layer keeps
    for (const [label, page] of [['page one', one], ['page two', two]] as const) {
      const leaks = await page.evaluate(() => (window as unknown as { __leaks: string[] }).__leaks);
      check(`no local sample data written into the sync keys (${label})`, leaks.length === 0, `${[...new Set(leaks)].join(', ')} (${leaks.length} writes)`);
    }
    const sync = await two.evaluate((uid) => ({ outbox: localStorage.getItem(`cma-sync-outbox:${uid}`), dead: localStorage.getItem(`cma-sync-deadletter:${uid}`), conflicts: localStorage.getItem(`cma-sync-conflicts:${uid}`) }), userId);
    check('the outbox holds no local sample data', !(sync.outbox ?? '').includes('p5-'));
    check('the set-aside log holds no local sample data', !(sync.dead ?? '').includes('p5-'), sync.dead ?? '');
    check('the conflict log holds no local sample data', !(sync.conflicts ?? '').includes('p5-'));

    // 10. the per-user outbox kept the pending change; the account's own data is still on this device
    check('the outbox kept the pending change', (sync.outbox ?? '').includes('profiles:self') && (sync.outbox ?? '').includes('Two Tab Name'));
    check('the account\'s data is still on this device', (await two.evaluate((k) => localStorage.getItem(k), studyKey)) !== null);

    // 9. local-mode keys are byte-for-byte what they were
    const localAfter = await readKeys(two, LOCAL_KEYS);
    check('local-mode keys are byte-for-byte unchanged', JSON.stringify(localAfter) === JSON.stringify(localBefore));
  } finally {
    await browser.close();
  }
}

// ---- main -------------------------------------------------------------------------------------------------------------------------
async function main() {
  if (sharedRows() !== 0) throw new Error('REFUSED: the shared curriculum tables are not empty, so this is not a clean local database. Nothing was changed.');
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(ROOT, 'supabase/tests/database/000_helpers.test.sql')], { env: pgEnv, stdio: 'ignore' });
  psql('select tests.build_fake_fixture()');
  const app = prepareApp(MUTATE);
  let server: ChildProcess | null = null;
  try {
    const userId = await createAccount();
    server = await serve(app.dir);
    await scenario(userId, `http://127.0.0.1:${PORT}`);
  } catch (error) {
    check(`scenario ran to completion (${error instanceof Error ? error.message.split('\n')[0] : 'error'})`, false);
  } finally {
    server?.kill();
    app.cleanup();
    try { psql(`delete from auth.users where email = '${EMAIL}'`); } catch { /* reported below */ }
    psql(`set session_replication_role = replica; delete from public.course_attempt_availability; delete from public.exam_attempts; delete from public.official_weightages; delete from public.chapters; delete from public.syllabus_sections; delete from public.subjects; delete from public.subject_groups; delete from public.course_syllabus_versions; delete from public.syllabus_versions; delete from public.courses; delete from public.study_resources; delete from public.source_references; delete from public.curriculum_import_batches;`);
    if (sharedRows() !== 0) failures.push('the fake fixture was not fully removed');
  }
  console.log(failures.length === 0 ? '\nTWO-TAB SCENARIO PASSED' : `\nTWO-TAB SCENARIO FAILED: ${failures.join('; ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
void main();
