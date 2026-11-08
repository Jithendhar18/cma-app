import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanText, type Finding } from './guard-secrets.ts';

const args = process.argv.slice(2);
const distIndex = args.indexOf('--dist');
const distDir = distIndex >= 0 ? args[distIndex + 1] : undefined;

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;
const SKIP = [/^package-lock\.json$/, /^node_modules\//];

function tracked(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const findings: Finding[] = [];
let scanned = 0;
const scan = (path: string, diskPath: string) => {
  if (BINARY.test(path) || SKIP.some((s) => s.test(path))) return;
  findings.push(...scanText(path, readFileSync(diskPath, 'utf8')));
  scanned += 1;
};

for (const file of tracked()) scan(file, file);
if (distDir) {
  for (const full of walk(distDir)) scan(`dist/${relative(distDir, full)}`, full);
}

if (findings.length > 0) {
  console.error(`SECRET GUARD FAILED: ${findings.length} finding(s). Values are not printed.`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  process.exit(1);
}
console.log(`secret guard: ${scanned} files scanned${distDir ? ` (including ${distDir}/)` : ''}, nothing found`);
