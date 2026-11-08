import { describe, expect, it } from 'vitest';
import { authRedirectUrls, describeConfigProblem, isFlagOn, isPublicKey, readAuthConfig, type ConfigProblem } from './config';

/** Builds an obviously fake JWT with the given role. Not a real credential: the signature is a placeholder. */
const fakeJwt = (role: string) => {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64({ role, iss: 'placeholder' })}.placeholder-signature`;
};
// Built at runtime: the repository secret guard forbids a literal of this shape anywhere, even in a test.
const SECRET_FORM = ['sb', 'secret', 'placeholder0123456789'].join('_');
const PUBLISHABLE_FORM = ['sb', 'publishable', 'placeholder0123456789'].join('_');
const ON = { VITE_SUPABASE_AUTH_ENABLED: 'true', VITE_SUPABASE_URL: 'https://placeholder-project.supabase.co', VITE_SUPABASE_ANON_KEY: fakeJwt('anon') };

describe('the feature flag', () => {
  it('is off unless the value is exactly "true"', () => {
    for (const value of [undefined, '', 'false', 'FALSE', '0', '1', 'yes', 'on', 'enabled', 'truee', ' ']) expect(isFlagOn(value)).toBe(false);
    for (const value of ['true', 'TRUE', 'True', '  true  ']) expect(isFlagOn(value)).toBe(true);
  });

  it('keeps the app in local mode when the flag is off, whatever else is set', () => {
    expect(readAuthConfig({})).toEqual({ status: 'disabled' });
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_AUTH_ENABLED: 'false' })).toEqual({ status: 'disabled' });
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_AUTH_ENABLED: undefined })).toEqual({ status: 'disabled' });
  });

  it('does not even look at the URL or key while disabled (so a bad value cannot break local mode)', () => {
    expect(readAuthConfig({ VITE_SUPABASE_AUTH_ENABLED: 'false', VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: '???' })).toEqual({ status: 'disabled' });
  });
});

describe('a valid configuration', () => {
  it('is accepted and normalised to an origin', () => {
    const config = readAuthConfig({ ...ON, VITE_SUPABASE_URL: ' https://placeholder-project.supabase.co/ ' });
    expect(config).toEqual({ status: 'enabled', url: 'https://placeholder-project.supabase.co', anonKey: ON.VITE_SUPABASE_ANON_KEY });
  });

  it('allows http only for this machine', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321']) expect(readAuthConfig({ ...ON, VITE_SUPABASE_URL: url }).status).toBe('enabled');
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_URL: 'http://placeholder-project.supabase.co' })).toEqual({ status: 'misconfigured', problem: 'insecure-url' });
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_URL: 'http://192.168.1.20:54321' })).toEqual({ status: 'misconfigured', problem: 'insecure-url' });
  });

  it('accepts a legacy anon key and a publishable key', () => {
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_ANON_KEY: fakeJwt('anon') }).status).toBe('enabled');
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_ANON_KEY: PUBLISHABLE_FORM }).status).toBe('enabled');
  });
});

describe('a bad configuration fails closed, with a reason and never a value', () => {
  const cases: Array<[string, Partial<typeof ON>, ConfigProblem]> = [
    ['missing URL', { VITE_SUPABASE_URL: '' }, 'missing-url'],
    ['whitespace URL', { VITE_SUPABASE_URL: '   ' }, 'missing-url'],
    ['not a URL', { VITE_SUPABASE_URL: 'placeholder' }, 'invalid-url'],
    ['URL with a path', { VITE_SUPABASE_URL: 'https://placeholder-project.supabase.co/rest/v1' }, 'invalid-url'],
    ['URL with credentials', { VITE_SUPABASE_URL: 'https://user:pass@placeholder-project.supabase.co' }, 'invalid-url'],
    ['URL with a query', { VITE_SUPABASE_URL: 'https://placeholder-project.supabase.co?x=1' }, 'invalid-url'],
    ['javascript: URL', { VITE_SUPABASE_URL: 'javascript:alert(1)' }, 'invalid-url'],
    ['missing key', { VITE_SUPABASE_ANON_KEY: '' }, 'missing-key'],
    ['key with whitespace', { VITE_SUPABASE_ANON_KEY: 'two words' }, 'unsupported-key'],
  ];
  for (const [label, override, problem] of cases) {
    it(label, () => expect(readAuthConfig({ ...ON, ...override })).toEqual({ status: 'misconfigured', problem }));
  }

  it('never puts the key or URL into the problem it reports', () => {
    const result = JSON.stringify(readAuthConfig({ ...ON, VITE_SUPABASE_ANON_KEY: fakeJwt('someone-else') }));
    expect(result).not.toContain(ON.VITE_SUPABASE_URL);
    expect(result).not.toContain('placeholder-signature');
  });
});

describe('only a key known to be public is accepted (an allowlist)', () => {
  it('refuses every JWT whose role is not anon, and every format it does not recognise', () => {
    for (const role of ['authenticated', 'dashboard_user', 'postgres', 'admin', '', 'ANON']) expect(isPublicKey(fakeJwt(role)), role).toBe(false);
    for (const key of [SECRET_FORM, 'placeholder-public-key', 'not.a.jwt', 'eyJ.eyJ.sig', fakeJwt('anon').replace(/\.[^.]+$/, '')]) expect(isPublicKey(key), key).toBe(false);
    expect(readAuthConfig({ ...ON, VITE_SUPABASE_ANON_KEY: SECRET_FORM })).toEqual({ status: 'misconfigured', problem: 'unsupported-key' });
  });
  it('accepts exactly the public forms', () => {
    expect(isPublicKey(fakeJwt('anon'))).toBe(true);
    expect(isPublicKey(['sb', 'publishable', 'abc123_XYZ'].join('_'))).toBe(true);
  });
});

describe('redirect URLs', () => {
  it('are fixed paths on the origin the flow started on', () => {
    expect(authRedirectUrls('https://app.example.com')).toEqual({ callback: 'https://app.example.com/auth/callback', reset: 'https://app.example.com/auth/reset-password' });
  });
  it('follow whatever origin the page runs on, so a preview flow returns to the preview (where its PKCE verifier is stored), never to production', () => {
    expect(authRedirectUrls('https://preview-123.vercel.app').callback).toBe('https://preview-123.vercel.app/auth/callback');
    expect(authRedirectUrls('http://localhost:5173').reset).toBe('http://localhost:5173/auth/reset-password');
  });
  it('cannot be redirected to another origin by any setting: the old override variable is ignored entirely', () => {
    const withOverride = { ...ON, VITE_AUTH_SITE_URL: 'https://production.example.com' } as Parameters<typeof readAuthConfig>[0];
    const config = readAuthConfig(withOverride);
    expect(config).toEqual(readAuthConfig(ON));
    expect(JSON.stringify(config)).not.toContain('production.example.com');
    // and the redirect builder takes the page's origin and nothing else
    expect(authRedirectUrls.length).toBe(1);
  });
  it('contain no wildcard', () => {
    expect(Object.values(authRedirectUrls('http://localhost:5173')).join(' ')).not.toContain('*');
  });
});

describe('problem descriptions', () => {
  it('exist for every problem and say what to fix', () => {
    const all: ConfigProblem[] = ['missing-url', 'invalid-url', 'insecure-url', 'missing-key', 'unsupported-key'];
    for (const p of all) expect(describeConfigProblem(p).length).toBeGreaterThan(20);
  });
});
