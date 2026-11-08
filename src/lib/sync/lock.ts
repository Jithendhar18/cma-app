/**
 * One tab at a time sends a user's outbox. Web Locks do this properly; where they do not exist (older browsers, tests) a short lease kept in
 * storage does it well enough: it expires, so a tab that closes mid-flush never blocks the others for long.
 */
export interface Exclusive {
  /** Runs `work` if this tab can be the one sending; returns `null` (without running it) if another tab is. */
  run<T>(name: string, work: () => Promise<T>): Promise<T | null>;
}

const LEASE_MS = 30_000;
const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createExclusive(storage: Storage = localStorage, now: () => number = Date.now, id: string = owner): Exclusive {
  return {
    async run(name, work) {
      const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      if (locks && typeof locks.request === 'function') {
        let result: { value: Awaited<ReturnType<typeof work>> } | null = null;
        await locks.request(name, { ifAvailable: true }, async (lock) => {
          if (lock) result = { value: await work() };
        });
        return result === null ? null : (result as { value: Awaited<ReturnType<typeof work>> }).value;
      }
      const key = `${name}:lease`;
      try {
        const current = JSON.parse(storage.getItem(key) ?? 'null') as { owner?: string; until?: number } | null;
        if (current && current.owner !== id && typeof current.until === 'number' && current.until > now()) return null;
        storage.setItem(key, JSON.stringify({ owner: id, until: now() + LEASE_MS }));
        // read back: two tabs writing at once, the later write wins and the other backs off
        const check = JSON.parse(storage.getItem(key) ?? 'null') as { owner?: string } | null;
        if (check?.owner !== id) return null;
      } catch {
        return work(); // storage unavailable: a single tab is the only realistic case
      }
      try {
        return await work();
      } finally {
        try {
          const current = JSON.parse(storage.getItem(key) ?? 'null') as { owner?: string } | null;
          if (current?.owner === id) storage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    },
  };
}
