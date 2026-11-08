import { LOCAL_KEYS } from '@/lib/account/keys';
import { loadSnapshot } from '@/lib/loadSnapshot';
import { todayISO } from '@/lib/dates';
import type { StudyDataSnapshot } from '@/types/study';

export type LocalRead =
  | { status: 'none' }
  | { status: 'unreadable' }
  | { status: 'ok'; snapshot: StudyDataSnapshot };

/**
 * Reads THIS device's local-mode study data, and nothing else. It touches exactly one browser key (`cma-study-os`), read-only: nothing is
 * written, removed or rewritten, whatever the outcome. It goes through the same upgrade and validation the local store itself uses, so what
 * the wizard sees is what local mode shows. (It cannot use the live store: in account mode that holds the account's data.)
 */
export function readLocalStudyData(storage: Storage = localStorage): LocalRead {
  let raw: string | null;
  try {
    raw = storage.getItem(LOCAL_KEYS[0]);
  } catch {
    return { status: 'unreadable' };
  }
  if (raw === null) return { status: 'none' };
  try {
    const parsed = JSON.parse(raw) as { state?: unknown };
    if (parsed.state === undefined || parsed.state === null) return { status: 'none' };
    const result = loadSnapshot(parsed.state, todayISO());
    return result.ok ? { status: 'ok', snapshot: result.data } : { status: 'unreadable' };
  } catch {
    return { status: 'unreadable' };
  }
}
