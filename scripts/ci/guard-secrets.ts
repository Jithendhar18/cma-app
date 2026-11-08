/**
 * CI guard for decision S4: the Supabase service-role key (and any other privileged credential) must
 * never enter frontend code, browser requests, Git, or client-side environment variables.
 *
 *   node --experimental-strip-types scripts/ci/guard-secrets.ts            scan tracked files
 *   node --experimental-strip-types scripts/ci/guard-secrets.ts --dist dist  also scan the built bundle
 *
 * It reports file, line and rule but never prints the secret itself. Exit code 1 on any finding.
 */

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

/** Paths whose content ships to the browser or configures its environment. The word "service role" has no business here. */
const BROWSER_ZONES = [/^src\//, /^public\//, /^index\.html$/, /^vercel\.json$/, /^vite\.config\.ts$/, /(^|\/)\.env(\..*)?$/, /^dist\//];

export const isBrowserZone = (path: string): boolean => BROWSER_ZONES.some((zone) => zone.test(path));

/** Decodes the payload of a JWT-shaped string, or null if it is not one. */
export function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin']);
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
// a database URL that carries a password, where the host is not this machine
const DB_URL = /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@([^\s/:?#]+)/gi;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'db']);
const SERVICE_ROLE_WORD = /service[_-]?role/i;
// A VITE_ variable is exposed to the browser by design, so none may be named like a secret.
const BROWSER_VAR_SECRETISH = /VITE_[A-Z0-9_]*(SERVICE|SECRET|PRIVATE|PASSWORD|DB_URL|DATABASE_URL|ADMIN|TOKEN)[A-Z0-9_]*/;

/** Scans one file's text. `path` decides which rules apply. */
export function scanText(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const browser = isBrowserZone(path);
  text.split('\n').forEach((content, index) => {
    const line = index + 1;
    const add = (rule: string) => findings.push({ file: path, line, rule });

    for (const match of content.matchAll(JWT_LIKE)) {
      const role = jwtRole(match[0]);
      if (role !== null && PRIVILEGED_ROLES.has(role)) add(`a JWT with the privileged role "${role}" is committed`);
    }
    if (SECRET_KEY.test(content)) add('a Supabase secret key (sb_secret_...) is committed');
    SECRET_KEY.lastIndex = 0;
    if (PRIVATE_KEY_BLOCK.test(content)) add('a private key block is committed');
    for (const match of content.matchAll(DB_URL)) {
      if (!LOCAL_HOSTS.has(match[1].toLowerCase())) add('a database connection string with a password for a non-local host is committed');
    }
    if (browser && SERVICE_ROLE_WORD.test(content)) add('the service role is referenced in browser-reachable code or configuration');
    if (BROWSER_VAR_SECRETISH.test(content)) add('a VITE_ (browser-exposed) variable is named like a secret');
  });
  return findings;
}
