/**
 * Curriculum tooling. Run with the npm scripts:
 *   npm run curriculum:validate -- <bundleDir> [--shared <dir>]
 *   npm run curriculum:sql      -- <bundleDir> [--shared <dir>] --out <file> [--no-transaction] [--allow-fake] [--allow-retire-all] [--allow-retire-all]
 *
 * Nothing here talks to a database or the network. It reads JSON and writes SQL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashBundle, loadBundle } from './bundle-io.ts';
import { findUnsafeSql, generateSql } from './generate-sql.ts';
import { validateBundle } from './validate.ts';

function usage(): never {
  console.error('usage: cli.ts <validate|sql> <bundleDir> [--shared <dir>] [--out <file>] [--no-transaction] [--allow-fake]');
  process.exit(2);
}

const [command, bundleArg, ...rest] = process.argv.slice(2);
if ((command !== 'validate' && command !== 'sql') || !bundleArg) usage();

const flag = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const bundleDir = resolve(bundleArg);
const sharedDir = resolve(flag('--shared') ?? resolve(bundleDir, '..', 'shared'));

const bundle = loadBundle(bundleDir, sharedDir);
const issues = validateBundle(bundle);
if (issues.length > 0) {
  console.error(`INVALID: ${issues.length} problem(s) in ${bundleArg}`);
  for (const issue of issues) console.error(`  ${issue.path}: ${issue.message}`);
  process.exit(1);
}

if (command === 'validate') {
  console.log(`OK: ${bundle.meta.bundleKey} v${bundle.meta.bundleVersion} is valid (${bundle.chapters.length} chapters, ${bundle.resources.length} resources)`);
  process.exit(0);
}

if (bundle.meta.bundleKey.startsWith('fake') && !rest.includes('--allow-fake')) {
  console.error('REFUSED: this is a FAKE fixture bundle. It must never become student-facing SQL. Use --allow-fake for tests only.');
  process.exit(3);
}
const out = flag('--out');
if (!out) usage();
if (resolve(out).includes(`${resolve('supabase', 'migrations')}`) && bundle.meta.bundleKey.startsWith('fake')) {
  console.error('REFUSED: a fake bundle cannot be written into supabase/migrations.');
  process.exit(3);
}

const allowRetireAll = rest.includes('--allow-retire-all');
const sql = generateSql(bundle, { contentSha256: hashBundle(bundle), transaction: !rest.includes('--no-transaction'), allowRetireAll });
const unsafe = findUnsafeSql(sql);
if (unsafe.length > 0) {
  console.error('UNSAFE generated SQL:');
  for (const issue of unsafe) console.error(`  ${issue.rule}: ${issue.excerpt}`);
  process.exit(1);
}
if (allowRetireAll) {
  console.warn('--allow-retire-all is set. If this import would retire EVERY active record in a scope, it will proceed.');
  console.warn(`Records this bundle keeps, per scope: groups ${bundle.groups.length}, subjects ${bundle.subjects.length}, sections ${bundle.sections.length}, chapters ${bundle.chapters.length}, weightages ${bundle.weightages.length}, resources ${bundle.resources.length}.`);
  console.warn('When applied, the database prints each affected scope and count, and the whole import stays transactional.');
}
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), sql);
console.log(`wrote ${out} (${sql.split('\n').length} lines)`);
