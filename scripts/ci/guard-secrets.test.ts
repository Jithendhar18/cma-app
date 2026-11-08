import { describe, expect, it } from 'vitest';
import { isBrowserZone, jwtRole, scanText } from './guard-secrets.ts';

// Tokens are assembled at runtime so no real-looking credential is ever written in source.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase-demo', role, exp: 1983812996 })}.${'s'.repeat(24)}`;
const rules = (path: string, text: string) => scanText(path, text).map((f) => f.rule);

describe('jwtRole', () => {
  it('reads the role claim', () => {
    expect(jwtRole(jwt('service_role'))).toBe('service_role');
    expect(jwtRole(jwt('anon'))).toBe('anon');
  });
  it('returns null for anything that is not a JWT', () => {
    expect(jwtRole('not-a-token')).toBeNull();
    expect(jwtRole('a.b.c')).toBeNull();
    expect(jwtRole(`${b64({ a: 1 })}.${Buffer.from('not json').toString('base64url')}.x`)).toBeNull();
  });
});

describe('browser zones', () => {
  it.each(['src/main.tsx', 'src/lib/x.ts', 'public/favicon.svg', 'index.html', 'vercel.json', 'vite.config.ts', '.env', '.env.local', 'app/.env.production', 'dist/assets/index-abc.js'])('%s is browser-reachable', (p) => {
    expect(isBrowserZone(p)).toBe(true);
  });
  it.each(['docs/architecture/rls-security.md', 'supabase/config.toml', 'supabase/migrations/1.sql', 'scripts/ci/guard-secrets.ts', 'README.md'])('%s is not', (p) => {
    expect(isBrowserZone(p)).toBe(false);
  });
});

describe('scanText: committed credentials (anywhere)', () => {
  it('flags a service-role JWT, in any file', () => {
    for (const path of ['src/a.ts', 'docs/notes.md', 'supabase/seed.sql', 'scripts/x.ts']) {
      expect(rules(path, `const k = "${jwt('service_role')}";`), path).toEqual(['a JWT with the privileged role "service_role" is committed']);
    }
  });
  it('flags a supabase_admin JWT', () => {
    expect(rules('README.md', jwt('supabase_admin')).length).toBe(1);
  });
  it('allows an anon JWT (it is public by design)', () => {
    expect(rules('README.md', jwt('anon'))).toEqual([]);
    expect(rules('src/a.ts', jwt('authenticated'))).toEqual([]);
  });
  it('flags a secret key and a private key block', () => {
    expect(rules('docs/a.md', `key: sb_secret_${'A'.repeat(24)}`)).toEqual(['a Supabase secret key (sb_secret_...) is committed']);
    expect(rules('docs/a.md', ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join(''))).toEqual(['a private key block is committed']);
  });
  it('flags a connection string with a password for a remote host but not for this machine', () => {
    const remote = ['postgresql://postgres:hunter2', '@db.example.invalid:5432/postgres'].join('');
    const local = ['postgresql://postgres:postgres', '@127.0.0.1:54322/postgres'].join('');
    expect(rules('docs/a.md', remote)).toEqual(['a database connection string with a password for a non-local host is committed']);
    expect(rules('docs/a.md', local)).toEqual([]);
    expect(rules('scripts/x.sh', ['postgres://u:p', '@localhost/db'].join(''))).toEqual([]);
  });
  it('does not print or retain the secret itself', () => {
    const findings = scanText('src/a.ts', jwt('service_role'));
    expect(JSON.stringify(findings)).not.toContain('eyJ');
  });
});

describe('scanText: the service role in browser-reachable code', () => {
  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'service_role', 'serviceRoleKey', 'service-role'])('flags "%s" under src/', (word) => {
    expect(rules('src/lib/supabase.ts', `const x = import.meta.env.${word};`)).toContain('the service role is referenced in browser-reachable code or configuration');
  });
  it('flags it in env files, vercel.json, index.html and the built bundle', () => {
    for (const path of ['.env', '.env.production', 'vercel.json', 'index.html', 'dist/assets/index-1.js']) {
      expect(rules(path, 'SUPABASE_SERVICE_ROLE_KEY=x'), path).toContain('the service role is referenced in browser-reachable code or configuration');
    }
  });
  it('allows discussing it in docs, SQL and config where it cannot reach the browser', () => {
    for (const path of ['docs/architecture/rls-security.md', 'supabase/migrations/x.sql', 'supabase/config.toml', 'scripts/ci/guard-secrets.ts']) {
      expect(rules(path, 'the service_role key bypasses RLS and must never reach the frontend'), path).toEqual([]);
    }
  });
});

describe('scanText: browser-exposed variables', () => {
  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'DB_PASSWORD', 'SECRET', 'ADMIN_TOKEN', 'DATABASE_URL', 'PRIVATE_KEY'].map((n) => `VITE_${n}`))('flags %s', (name) => {
    expect(rules('src/a.ts', `import.meta.env.${name}`)).toContain('a VITE_ (browser-exposed) variable is named like a secret');
  });
  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_APP_NAME'])('allows %s', (name) => {
    expect(rules('src/a.ts', `import.meta.env.${name}`)).toEqual([]);
  });
});

describe('scanText: reporting', () => {
  it('reports the file and 1-based line', () => {
    const f = scanText('src/a.ts', `line one\nconst k = "${jwt('service_role')}";\nline three`);
    expect(f).toEqual([{ file: 'src/a.ts', line: 2, rule: 'a JWT with the privileged role "service_role" is committed' }]);
  });
  it('finds nothing in ordinary code', () => {
    expect(scanText('src/a.ts', 'export const x = 1;\nconst url = import.meta.env.VITE_SUPABASE_URL;')).toEqual([]);
  });
});
