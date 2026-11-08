/**
 * How a failed request is treated. The distinction decides what happens to the queued change:
 *   offline    the device cannot reach the server: keep everything, wait for the connection (not an error, not counted as an attempt)
 *   transient  the server is struggling or rate limiting: try again later with a growing delay
 *   auth       the session is not accepted: refresh it once, then pause rather than hammer the server
 *   quota      the account is at its row limit: tell the student, do not retry
 *   rejected   the database refused this row for good (a rule it breaks): set it aside; it can never succeed as written
 */
export type FailureKind = 'offline' | 'transient' | 'auth' | 'quota' | 'rejected';

export function classifyFailure(error: unknown): { kind: FailureKind; detail: string } {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; status?: unknown; name?: unknown; message?: unknown; hint?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  const lower = message.toLowerCase();
  const detail = code ? `${code}` : message.slice(0, 120) || 'unknown error';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline', detail: 'offline' };
  if (error instanceof TypeError || e.name === 'AuthRetryableFetchError' || status === 0 || /failed to fetch|networkerror|load failed|network request failed/.test(lower)) return { kind: 'offline', detail: 'network' };
  if (code === 'P0429' || e.hint === 'QUOTA_EXCEEDED' || /quota exceeded/.test(lower)) return { kind: 'quota', detail: 'quota' };
  if (status === 401 || code === '28000' || code === 'PGRST301' || code === 'PGRST303' || /jwt (expired|invalid)|invalid jwt/.test(lower)) return { kind: 'auth', detail: 'auth' };
  if (status === 429 || (status !== undefined && status >= 500) || code === '57014' || code === '40001' || code === '40P01' || code.startsWith('08') || code.startsWith('53') || code.startsWith('57P') || /timeout|temporarily|too many requests/.test(lower)) return { kind: 'transient', detail: code || String(status ?? 'transient') };
  if (code.startsWith('23') || code.startsWith('22') || code === '42501' || code.startsWith('PGRST1') || status === 400 || status === 403 || status === 404 || status === 409 || status === 422) return { kind: 'rejected', detail: code || String(status) };
  return { kind: 'transient', detail };
}

/** Exponential backoff with jitter: ~2s, 4s, 8s ... capped at 5 minutes. `random` is injectable so tests are deterministic. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(5 * 60_000, 2000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}
