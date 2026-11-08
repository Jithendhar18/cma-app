import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './returnPath';

describe('safeReturnPath (where to go after sign-in)', () => {
  it('accepts paths inside the app, with their query', () => {
    for (const p of ['/', '/account', '/subjects/p5', '/settings?tab=data', '/analytics#top']) expect(safeReturnPath(p), p).toBe(p);
  });

  it('refuses anything that could leave the app (open-redirect attempts)', () => {
    for (const p of [
      '//evil.example', '//evil.example/path', '///evil.example', '/\\evil.example', '\\\\evil.example', '/ok\\..\\evil',
      'https://evil.example', 'http://evil.example', 'javascript:alert(1)', 'data:text/html,x', 'evil.example', '', ' /account', 'account', '/%2F%2Fevil.example'.replace('%2F', '/'),
    ]) expect(safeReturnPath(p), p).toBeNull();
  });

  it('refuses the auth screens themselves, which would loop', () => {
    for (const p of ['/auth', '/auth/sign-in', '/auth/callback?code=x', '/auth/reset-password']) expect(safeReturnPath(p), p).toBeNull();
    expect(safeReturnPath('/authors')).toBe('/authors'); // only the /auth route family is excluded
  });

  it('refuses values that are not strings', () => {
    for (const v of [undefined, null, 5, {}, ['/account'], true]) expect(safeReturnPath(v)).toBeNull();
  });
});
