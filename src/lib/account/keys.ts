/**
 * Every storage key account mode uses. They are all namespaced by the user id, and none of them is, or starts with, a key local mode
 * uses (`cma-study-os`, `cma-study-os-timer`, `cma-study-os-ui`), so the two worlds cannot touch each other's data.
 */
export const LOCAL_KEYS = ['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui'] as const;

export interface AccountKeys {
  study: string;
  timer: string;
  outbox: string;
  meta: string;
  conflicts: string;
  deadLetter: string;
  mode: string;
  importJob: string;
}

const SAFE = /^[A-Za-z0-9-]{1,64}$/;

export function accountKeys(userId: string): AccountKeys {
  // A user id is a UUID. Refuse anything else so a malformed id can never build a key that collides with another one.
  if (!SAFE.test(userId)) throw new Error('Invalid user id for storage keys.');
  return {
    study: `cma-study-os:${userId}`,
    timer: `cma-study-os-timer:${userId}`,
    outbox: `cma-sync-outbox:${userId}`,
    meta: `cma-sync-meta:${userId}`,
    conflicts: `cma-sync-conflicts:${userId}`,
    deadLetter: `cma-sync-deadletter:${userId}`,
    mode: `cma-app-mode:${userId}`,
    importJob: `cma-import-job:${userId}`,
  };
}

/**
 * Removes every browser key that belongs to ONE account (its study mirror, timer, queue, logs, mode choice, import progress, sync lease).
 * Used only after the server has confirmed that account's deletion. Local-mode keys have no user suffix and are never touched.
 */
export function clearAccountKeys(userId: string, storage: Storage = localStorage): string[] {
  accountKeys(userId); // refuses a malformed id, so a bad value can never widen the match
  const mine = (k: string) => k.startsWith('cma-') && !(LOCAL_KEYS as readonly string[]).includes(k) && (k.endsWith(`:${userId}`) || k.includes(`:${userId}:`));
  const removed: string[] = [];
  try {
    for (const k of Object.keys(storage)) if (mine(k)) removed.push(k);
    for (const k of removed) storage.removeItem(k);
  } catch {
    /* storage unavailable: nothing to clear */
  }
  return removed;
}
