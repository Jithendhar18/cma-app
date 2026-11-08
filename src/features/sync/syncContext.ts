import { createContext, useContext } from 'react';
import type { ConflictEntry, SyncDiagnostics, SyncStatus } from '@/lib/sync/types';
import type { DeadLetter } from '@/lib/sync/engine';

export interface SyncValue {
  /** True only while an account's study data is being kept in step with the server. Local mode is never active. */
  active: boolean;
  status: SyncStatus;
  /** Tries now: pulls, then sends. */
  retry: () => void;
  /** Sends everything pending and says whether it all arrived. */
  flushAll: () => Promise<{ ok: boolean; pending: number }>;
  conflicts: ConflictEntry[];
  deadLetters: DeadLetter[];
  dismissConflict: (id: string) => void;
  retryDeadLetter: (id: string) => void;
  discardDeadLetter: (id: string) => void;
  /** The conflict log, set-aside changes and pending changes as plain data, for the student to keep. */
  exportDiagnostics: () => unknown;
  /** Counts and times for troubleshooting (never study content). */
  diagnostics: () => SyncDiagnostics | null;
  /** After a session that was paused by an expired login has been renewed. */
  unpause: () => void;
}

export const IDLE_STATUS: SyncStatus = { phase: 'idle', pending: 0, deadLettered: 0, conflicts: 0, lastSyncedAt: null, message: null };

export const INACTIVE: SyncValue = {
  active: false, status: IDLE_STATUS, retry: () => undefined, flushAll: async () => ({ ok: true, pending: 0 }), conflicts: [], deadLetters: [],
  dismissConflict: () => undefined, retryDeadLetter: () => undefined, discardDeadLetter: () => undefined, exportDiagnostics: () => ({}), diagnostics: () => null, unpause: () => undefined,
};

export const SyncContext = createContext<SyncValue>(INACTIVE);

/** Tolerates a missing provider: it is then simply "not syncing", as in local mode. */
export const useSync = (): SyncValue => useContext(SyncContext);
