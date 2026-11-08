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
  };
}
