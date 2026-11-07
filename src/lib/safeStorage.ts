import type { StateStorage } from 'zustand/middleware';

export const STORAGE_ERROR_EVENT = 'cma-storage-error';
export const CORRUPT_BACKUP_PREFIX = 'cma-study-os-corrupt-backup';

/** Keeps a copy of data we could not use, so a bad write never silently destroys it. */
export function backupCorrupt(storage: Storage, key: string, raw: string): void {
  try {
    storage.setItem(`${CORRUPT_BACKUP_PREFIX}:${key}:${Date.now()}`, raw);
  } catch {
    /* storage full or unavailable: nothing more we can do */
  }
}

/**
 * localStorage wrapper for zustand. Reads never throw: unparseable JSON is backed up under a
 * separate key and reported as "empty". Writes never throw either; a full or blocked storage
 * degrades to in-memory state instead of crashing the app.
 */
export function createSafeStorage(getStorage: () => Storage | undefined = () => globalThis.localStorage): StateStorage {
  return {
    getItem: (name) => {
      const storage = getStorage();
      if (!storage) return null;
      let raw: string | null;
      try {
        raw = storage.getItem(name);
      } catch {
        return null;
      }
      if (raw === null) return null;
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        backupCorrupt(storage, name, raw);
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        getStorage()?.setItem(name, value);
      } catch (error) {
        console.error(`Could not save "${name}" (storage full or blocked).`, error);
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_ERROR_EVENT));
      }
    },
    removeItem: (name) => {
      try {
        getStorage()?.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}
