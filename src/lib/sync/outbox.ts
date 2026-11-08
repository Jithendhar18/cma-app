import { diffEntities } from './diff';
import { entityId, WRITE_ORDER, type EntityMap, type Op, type Table } from './types';

/** What the server is known to hold for each entity (so a new op knows whether it is an insert or an update, and on which version). */
export type KnownMap = ReadonlyMap<string, { version: string; serverId: string }>;

const TABLE_SET = new Set<string>(Object.keys(WRITE_ORDER));
const isOp = (v: unknown): v is Op => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && (o.kind === 'upsert' || o.kind === 'delete') && typeof o.table === 'string' && TABLE_SET.has(o.table) && typeof o.key === 'string'
    && typeof o.isNew === 'boolean' && typeof o.attempts === 'number' && (o.kind === 'delete' || (typeof o.row === 'object' && o.row !== null));
};

export const MAX_BATCH = 200;

/**
 * The persistent queue of changes not yet confirmed by the server. At most one op per entity: later edits are folded into the pending one
 * (coalescing), and a row created and deleted before it ever reached the server leaves nothing behind. Persisted on every change, so a
 * reload, a crash or being offline never loses a pending write.
 */
export class Outbox {
  private ops = new Map<string, Op>();
  /** The text last read from or written to disk, so a change made by another tab is noticed before this one writes over it. */
  private lastRaw: string | null = null;
  /** True if what was on disk could not be read (it is left untouched until the next successful save). */
  corrupted = false;

  constructor(private readonly key: string, private readonly storage: Storage = localStorage) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage.getItem(this.key);
      this.lastRaw = raw;
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const list = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { ops?: unknown }).ops) ? ((parsed as { ops: unknown[] }).ops) : null;
      if (!list) throw new Error('shape');
      const valid = list.filter(isOp);
      if (valid.length !== list.length) this.corrupted = true;
      for (const op of valid) this.ops.set(op.id, op);
    } catch {
      this.corrupted = true;
    }
  }

  /** Reloads from disk (another tab may have written). */
  reload(): void {
    this.ops = new Map();
    this.corrupted = false;
    this.load();
  }

  /** Picks up what another tab has written since this one last looked. Every change starts with this, so tabs never overwrite each other. */
  private refresh(): void {
    try {
      if (this.storage.getItem(this.key) !== this.lastRaw) this.reload();
    } catch {
      /* storage unavailable: memory only */
    }
  }

  private save(): void {
    try {
      const text = JSON.stringify({ v: 1, ops: [...this.ops.values()] });
      this.storage.setItem(this.key, text);
      this.lastRaw = text;
      this.corrupted = false;
    } catch {
      /* storage full or blocked: the queue still works in memory for this session */
    }
  }

  get size(): number {
    return this.ops.size;
  }
  all(): Op[] {
    return [...this.ops.values()];
  }
  has(id: string): boolean {
    return this.ops.has(id);
  }

  /** Turns a change in the entity set into queued ops, folding it into anything already queued for the same entity. */
  enqueueDiff(before: EntityMap, after: EntityMap, known: KnownMap, now: string): void {
    this.refresh();
    for (const change of diffEntities(before, after)) {
      const { entity } = change;
      const id = entityId(entity.table, entity.key);
      const existing = this.ops.get(id);
      const server = known.get(id);
      if (change.kind === 'upsert') {
        if (existing) {
          // an edit on top of a queued upsert keeps that op's insert/update nature and base version; a re-creation after a queued delete is an update
          this.ops.set(id, { ...existing, kind: 'upsert', row: entity.row, isNew: existing.kind === 'delete' ? false : existing.isNew, notBefore: null, lastError: null });
        } else {
          this.ops.set(id, { id, kind: 'upsert', table: entity.table, key: entity.key, row: entity.row, isNew: !server, baseVersion: server?.version ?? null, serverId: server?.serverId ?? null, queuedAt: now, attempts: 0, notBefore: null, lastError: null });
        }
      } else if (existing) {
        if (existing.kind === 'upsert' && existing.isNew) this.ops.delete(id); // never reached the server: nothing to undo there
        else this.ops.set(id, { ...existing, kind: 'delete', row: undefined, notBefore: null, lastError: null });
      } else if (server) {
        this.ops.set(id, { id, kind: 'delete', table: entity.table, key: entity.key, isNew: false, baseVersion: server.version, serverId: server.serverId, queuedAt: now, attempts: 0, notBefore: null, lastError: null });
      }
    }
    this.save();
  }

  /**
   * The next batch to send: upserts parents-first, then deletes children-first, only those due, at most `max`. Anything earlier in that
   * order that is not due holds back what depends on it (a focus record is never sent before its planned session).
   */
  nextBatch(now: string, max = MAX_BATCH): Op[] {
    const due = (o: Op) => o.notBefore === null || o.notBefore <= now;
    const ups = this.all().filter((o) => o.kind === 'upsert').sort((a, b) => WRITE_ORDER[a.table] - WRITE_ORDER[b.table] || a.queuedAt.localeCompare(b.queuedAt));
    const dels = this.all().filter((o) => o.kind === 'delete').sort((a, b) => WRITE_ORDER[b.table] - WRITE_ORDER[a.table] || a.queuedAt.localeCompare(b.queuedAt));
    const ordered = [...ups, ...dels];
    const batch: Op[] = [];
    for (const op of ordered) {
      if (!due(op)) continue;
      batch.push(op);
      if (batch.length >= max) break;
    }
    return batch;
  }

  /** Earliest time any queued op becomes due again, or null. */
  nextDueAt(): string | null {
    const times = this.all().map((o) => o.notBefore).filter((t): t is string => t !== null);
    return times.length === 0 ? null : times.sort()[0];
  }

  remove(ids: string[]): void {
    this.refresh();
    for (const id of ids) this.ops.delete(id);
    this.save();
  }
  /** Adds or replaces the op for its entity (used to put a set-aside change back). */
  put(op: Op): void {
    this.refresh();
    this.ops.set(op.id, op);
    this.save();
  }
  update(op: Op): void {
    this.refresh();
    if (this.ops.has(op.id)) this.ops.set(op.id, op);
    this.save();
  }
  clear(): void {
    this.refresh();
    this.ops = new Map();
    this.save();
  }
  countFor(table: Table): number {
    return this.all().filter((o) => o.table === table).length;
  }
}
