import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pins the deployed security headers (vercel.json) so a later edit cannot quietly weaken them. The CSP was also verified in a
 * real browser against the production build (see docs/architecture/m6-auth-review.md).
 */
const config = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8')) as {
  rewrites: Array<{ source: string; destination: string }>;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

const allHeaders = config.headers.find((h) => h.source === '/(.*)')?.headers ?? [];
const header = (key: string) => allHeaders.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
const csp = header('Content-Security-Policy') ?? '';
const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...sources] = d.split(/\s+/); return [name, sources] as const; }));

describe('Content-Security-Policy', () => {
  it('exists and parses', () => {
    expect(csp.length).toBeGreaterThan(50);
    expect(directives.size).toBeGreaterThan(8);
  });

  it('never allows eval, anywhere', () => {
    expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
  });

  it('never uses a wildcard source', () => {
    for (const [name, sources] of directives) for (const s of sources) expect(s, `${name}: ${s}`).not.toMatch(/\*/);
  });

  it('allows only the app\'s own scripts: no inline script, no external script, no data: or http: script', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('default-src')).toEqual(["'self'"]);
  });

  it('keeps inline styles to style ATTRIBUTES only (which the UI libraries need) and never inline <style> elements', () => {
    expect(directives.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    expect(directives.get('style-src')).not.toContain("'unsafe-inline'");
    expect(directives.get('style-src-elem')).not.toContain("'unsafe-inline'");
    expect(directives.get('style-src-elem')).toEqual(["'self'", 'https://fonts.googleapis.com']);
  });

  it('allows fonts only from the app and Google Fonts (the app imports Inter from there)', () => {
    expect(directives.get('font-src')).toEqual(["'self'", 'https://fonts.gstatic.com']);
  });

  it('allows images from the app, data: URLs and blob: URLs (the avatar), and nothing remote', () => {
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
  });

  it('limits network connections to the app, and any other origin must be one exact https origin', () => {
    const [self, ...rest] = directives.get('connect-src') ?? [];
    expect(self).toBe("'self'");
    for (const origin of rest) expect(origin, origin).toMatch(/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/); // exact host, no path, no wildcard, https only
  });

  it('forbids plugins, base-tag hijacking, off-site form posts and framing', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('form-action')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });
});

describe('the other headers', () => {
  it('sets only the security headers that are needed', () => {
    expect(allHeaders.map((h) => h.key).sort()).toEqual(['Content-Security-Policy', 'Permissions-Policy', 'Referrer-Policy', 'X-Content-Type-Options']);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
  });
  it('keeps one-time email-link codes out of cross-origin Referer headers', () => {
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
  it('turns off powerful browser features the app does not use', () => {
    expect(header('Permissions-Policy')).toMatch(/camera=\(\)/);
    expect(header('Permissions-Policy')).toMatch(/microphone=\(\)/);
    expect(header('Permissions-Policy')).toMatch(/geolocation=\(\)/);
  });
});

describe('what was already there is preserved', () => {
  it('still serves the single-page app from every path', () => {
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });
  it('still caches hashed assets for a year', () => {
    const assets = config.headers.find((h) => h.source === '/assets/(.*)');
    expect(assets?.headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
  });
  it('does not name a Supabase project (none exists yet): that origin is added at hosted rollout and documented', () => {
    expect(csp).not.toMatch(/supabase\.co|supabase\.in/);
  });
});
