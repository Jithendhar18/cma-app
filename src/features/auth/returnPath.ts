/**
 * Where to send a user after signing in. The value comes from router state, which a link or another page can influence, so it
 * is accepted only if it is a path inside this app: it must start with a single "/", must not be protocol-relative ("//host")
 * or contain a backslash (some browsers treat "/\\host" as "//host"), and must not be an auth screen (that would loop).
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (value === '/auth' || value.startsWith('/auth/')) return null;
  return value;
}
