import { accountKeys } from '@/lib/account/keys';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import { SupabasePersonal } from '@/lib/sync/supabasePersonal';
import { WRITE_ORDER, type Entity, type Op, type PersonalRepository, type Scope } from '@/lib/sync/types';
import { IMPORT_TABLES, TABLE_LABEL, type ImportExclusions, type ImportMapping, type ImportPlan, type ImportTable } from './importPlan';

/**
 * Executes an approved import plan. It writes ONLY through the same repository the sync engine uses (authenticated, row-level secured,
 * deterministic client ids, insert-if-absent), so:
 *   - running it twice, or resuming after a failure, writes nothing twice (a record that is already there with the same content counts as done);
 *   - a record that exists with DIFFERENT content is never overwritten (server wins) and is reported;
 *   - one refused record never prevents the others from going in.
 * It never reads or writes a local-mode key, never touches the timer, and never changes the local data.
 */

export interface TableOutcome { imported: number; alreadyThere: number; keptAccountVersion: number; failed: number; waiting: number }
export interface ImportFailure { table: ImportTable; key: string; detail: string }
export type RunState = 'complete' | 'partial' | 'waiting' | 'paused';
export interface ImportResult {
  state: RunState;
  outcomes: Record<ImportTable, TableOutcome>;
  failures: ImportFailure[];
  /** Why it stopped early (offline or signed out), if it did. */
  stoppedBecause: 'offline' | 'auth' | null;
}

const emptyOutcome = (): TableOutcome => ({ imported: 0, alreadyThere: 0, keptAccountVersion: 0, failed: 0, waiting: 0 });
export const CHUNK = 50;

const toOp = (e: Entity, at: string): Op => ({
  id: `${e.table}:${e.key}`, kind: 'upsert', table: e.table, key: e.key, row: e.row, isNew: true, baseVersion: null, serverId: null, queuedAt: at, attempts: 0, notBefore: null, lastError: null,
});

export async function runImport(args: {
  plan: ImportPlan;
  scope: Scope;
  repo: PersonalRepository;
  onProgress?: (done: number, total: number, outcomes: Record<ImportTable, TableOutcome>) => void;
  signal?: { cancelled: boolean };
  now?: () => string;
}): Promise<ImportResult> {
  const { plan, scope, repo } = args;
  const now = args.now ?? (() => new Date().toISOString());
  const outcomes = Object.fromEntries(IMPORT_TABLES.map((t) => [t, emptyOutcome()])) as Record<ImportTable, TableOutcome>;
  const failures: ImportFailure[] = [];
  // Parents first (a planned session before the focus record that credits it), the same order the sync engine uses.
  const ordered = [...plan.ready].sort((a, b) => WRITE_ORDER[a.table] - WRITE_ORDER[b.table]);
  const total = ordered.length;
  let done = 0;
  let attempted = 0;
  let stoppedBecause: ImportResult['stoppedBecause'] = null;

  for (let i = 0; i < ordered.length && !stoppedBecause; i += CHUNK) {
    if (args.signal?.cancelled) break;
    const chunk = ordered.slice(i, i + CHUNK);
    attempted += chunk.length;
    const results = await repo.push(scope, chunk.map((e) => toOp(e, now())));
    for (const r of results) {
      const table = r.op.table as ImportTable;
      if (r.status === 'applied') { outcomes[table].imported++; done++; }
      else if (r.status === 'conflict' && r.server !== null) { outcomes[table].keptAccountVersion++; done++; }
      else if (r.status === 'conflict') {
        // The same id is not there, yet the database refused the record: it clashes with a different record (for example the same revision
        // number for the same chapter). It is NOT saved, so it is reported as refused, never as "kept".
        outcomes[table].failed++;
        failures.push({ table, key: r.op.key, detail: 'It clashes with a record that is already in your account (for example, the same revision for that chapter).' });
        done++;
      }
      else if (r.status === 'rejected') { outcomes[table].failed++; failures.push({ table, key: r.op.key, detail: r.detail }); done++; }
      else if (r.status === 'auth') { outcomes[table].waiting++; stoppedBecause = 'auth'; }
      else if (r.reason === 'offline') { outcomes[table].waiting++; stoppedBecause = 'offline'; }
      else outcomes[table].waiting++; // a transient failure: this record waits for a retry, the rest carry on
    }
    args.onProgress?.(done, total, outcomes);
  }
  // Anything never sent (the run stopped early) is waiting too, so nothing is ever unaccounted for.
  for (const e of ordered.slice(attempted)) outcomes[e.table as ImportTable].waiting++;
  const waiting = IMPORT_TABLES.reduce((n, t) => n + outcomes[t].waiting, 0);
  const state: RunState = stoppedBecause ? 'paused' : waiting > 0 ? 'waiting' : failures.length > 0 ? 'partial' : 'complete';
  return { state, outcomes, failures, stoppedBecause };
}

// ---- progress that survives a reload (the student's choices, so a resume does not start over) ---------------------------------------------
export interface ImportJob {
  version: 1;
  enrollmentId: string;
  mapping: ImportMapping;
  excluded: ImportExclusions;
  copySettings: boolean;
  startedAt: string | null;
  updatedAt: string;
  state: RunState | 'draft';
  /** Plain counts only: never the study content itself. */
  summary: Partial<Record<ImportTable, number>> | null;
}

export function readJob(userId: string, enrollmentId: string, storage: Storage = localStorage): ImportJob | null {
  try {
    const raw = storage.getItem(accountKeys(userId).importJob);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<ImportJob>;
    if (j.version !== 1 || j.enrollmentId !== enrollmentId || typeof j.mapping !== 'object' || j.mapping === null || typeof j.excluded !== 'object' || j.excluded === null) return null;
    return j as ImportJob;
  } catch {
    return null;
  }
}
export function writeJob(userId: string, job: ImportJob, storage: Storage = localStorage): void {
  try {
    storage.setItem(accountKeys(userId).importJob, JSON.stringify(job));
  } catch {
    /* the wizard still works for this session */
  }
}

// ---- the record that this exact approved data was imported (one row per fingerprint, enforced by the database) ----------------------------
export interface ImportRunRecord { sha256: string; enrollmentId: string; importedAt: string }

export async function readRecordedRuns(client: AppSupabaseClient, userId: string): Promise<ImportRunRecord[]> {
  const { data, error } = await client.from('local_import_runs').select('source_sha256, enrollment_id, imported_at').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ sha256: String(r.source_sha256), enrollmentId: String(r.enrollment_id), importedAt: String(r.imported_at) }));
}

export async function recordRun(client: AppSupabaseClient, scope: Scope, sha256: string, counts: Partial<Record<ImportTable, number>>): Promise<'recorded' | 'already-recorded' | 'failed'> {
  const { error } = await client.from('local_import_runs').insert({ user_id: scope.userId, enrollment_id: scope.enrollmentId, source_sha256: sha256, counts });
  if (!error) return 'recorded';
  return (error as { code?: string }).code === '23505' ? 'already-recorded' : 'failed';
}

export const makeRepo = (client: AppSupabaseClient): PersonalRepository => new SupabasePersonal(client);
export { TABLE_LABEL };
