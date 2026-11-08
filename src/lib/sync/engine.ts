import { Outbox, type KnownMap } from './outbox';
import { backoffMs } from './errors';
import { createExclusive, type Exclusive } from './lock';
import { entitiesToSnapshot, snapshotToEntities, validateEntity, type BaseForRows } from './mappers';
import { entityId, isSingle, toMap, type ConflictEntry, type Entity, type EntityMap, type Op, type PersonalRepository, type PushResult, type Scope, type ServerEntity, type SyncPhase, type SyncStatus } from './types';
import type { StudyDataSnapshot } from '@/types/study';
import { accountKeys } from '@/lib/account/keys';

const MAX_CONFLICTS = 200;
const MAX_TRANSIENT_ATTEMPTS = 12;
export const POLL_MS = 60_000;
export const RECONCILE_MS = 30 * 60_000;

export interface DeadLetter {
  id: string;
  at: string;
  op: Op;
  reason: string;
}

export interface EngineDeps {
  scope: Scope;
  repo: PersonalRepository;
  /** The attempt's official exam start date, so only a student-defined date is ever treated as an override. */
  officialExamDate?: () => string | null;
  /** The current snapshot in the store. */
  read: () => StudyDataSnapshot;
  /** The curriculum's blank chapters and the settings, which chapters and records are rebuilt on top of. `keep` lists retired chapters the student has records on. */
  base: (keep: ReadonlySet<string>) => BaseForRows;
  /** Puts a server-derived snapshot into the store. Must NOT be treated as a user edit. */
  apply: (snapshot: StudyDataSnapshot) => void;
  storage?: Storage;
  now?: () => string;
  random?: () => number;
  exclusive?: Exclusive;
  /** False whenever the stores are not showing THIS account's enrolment (local mode, sign-out, another enrolment). The engine then does nothing. */
  isBound?: () => boolean;
  /** Asks the auth layer for a fresh session. Resolves true if one was obtained. */
  refreshSession?: () => Promise<boolean>;
  online?: () => boolean;
  /** Timer functions, injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type { KnownMap };

/**
 * Keeps one enrolment's personal data in step with the server.
 *
 * The rules, in the order they matter:
 *   - the student's device never loses a pending change: it is queued on disk before anything is sent, and only removed once confirmed
 *   - the server wins a real conflict (D5), but never silently: the losing change is kept in a log the student can read and export
 *   - nothing the server returns replaces a row that has a pending change; that change is reconciled when it is sent
 *   - the engine never throws to its caller: every failure becomes a status
 */
export class SyncEngine {
  private readonly storage: Storage;
  private readonly now: () => string;
  private readonly random: () => number;
  private readonly exclusive: Exclusive;
  private readonly online: () => boolean;
  private readonly keys: ReturnType<typeof accountKeys>;
  readonly outbox: Outbox;

  private known = new Map<string, { version: string; serverId: string }>();
  private seen: EntityMap = new Map();
  private conflicts: ConflictEntry[] = [];
  private deadLetters: DeadLetter[] = [];
  private cursor: string | null = null;
  private lastSyncedAt: string | null = null;
  private phase: SyncPhase = 'idle';
  private message: string | null = null;
  private hydrated = false;
  private flushing = false;
  private paused = false;
  private disposed = false;
  private timers: unknown[] = [];
  private status$: SyncStatus;
  private listeners = new Set<(s: SyncStatus) => void>();
  readonly sessionKey = `${Date.now()}`;

  constructor(private readonly deps: EngineDeps) {
    this.storage = deps.storage ?? localStorage;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.random = deps.random ?? Math.random;
    this.keys = accountKeys(deps.scope.userId);
    this.exclusive = deps.exclusive ?? createExclusive(this.storage);
    this.online = deps.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.outbox = new Outbox(this.keys.outbox, this.storage);
    this.conflicts = this.readList(this.keys.conflicts) as ConflictEntry[];
    this.deadLetters = this.readList(this.keys.deadLetter) as DeadLetter[];
    this.loadMeta();
    this.status$ = this.computeStatus();
  }

  private entitiesNow(): EntityMap {
    return snapshotToEntities(this.deps.read(), { officialExamDate: this.deps.officialExamDate?.() ?? null });
  }

  /** True while it is correct for this engine to read the store, write to it and talk to the server. */
  private get live(): boolean {
    return !this.disposed && (this.deps.isBound?.() ?? true);
  }

  // ---- status -------------------------------------------------------------------------------------------------------------------
  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getStatus = (): SyncStatus => this.status$;
  private computeStatus(): SyncStatus {
    const attention = this.deadLetters.length > 0 || this.outbox.corrupted;
    let phase = this.phase;
    if (this.paused) phase = 'paused';
    else if (phase === 'idle' && attention) phase = 'attention';
    return { phase, pending: this.outbox.size, deadLettered: this.deadLetters.length, conflicts: this.conflicts.length, lastSyncedAt: this.lastSyncedAt, message: this.message ?? (this.outbox.corrupted ? 'Some saved changes could not be read.' : null) };
  }
  private publish(phase?: SyncPhase, message?: string | null): void {
    if (phase !== undefined) this.phase = phase;
    if (message !== undefined) this.message = message;
    const next = this.computeStatus();
    const prev = this.status$;
    if (prev.phase === next.phase && prev.pending === next.pending && prev.deadLettered === next.deadLettered && prev.conflicts === next.conflicts && prev.message === next.message && prev.lastSyncedAt === next.lastSyncedAt) return;
    this.status$ = next;
    this.listeners.forEach((l) => l(next));
  }

  // ---- persistence --------------------------------------------------------------------------------------------------------------
  private readList(key: string): unknown[] {
    try {
      const raw = this.storage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'object' && x !== null) : [];
    } catch {
      return [];
    }
  }
  private writeList(key: string, list: unknown[]): void {
    try {
      this.storage.setItem(key, JSON.stringify(list));
    } catch {
      /* kept in memory for this session */
    }
  }
  private loadMeta(): void {
    try {
      const raw = this.storage.getItem(this.keys.meta);
      const meta = raw ? (JSON.parse(raw) as { scope?: Partial<Scope>; sync?: { cursor?: unknown; lastSyncedAt?: unknown; known?: unknown } }) : {};
      // Only trust what was recorded for THIS enrolment of THIS syllabus.
      if (meta.scope?.enrollmentId !== this.deps.scope.enrollmentId || meta.scope?.csvId !== this.deps.scope.csvId) return;
      const s = meta.sync;
      if (typeof s?.cursor === 'string') this.cursor = s.cursor;
      if (typeof s?.lastSyncedAt === 'string') this.lastSyncedAt = s.lastSyncedAt;
      if (Array.isArray(s?.known)) for (const k of s.known) if (Array.isArray(k) && typeof k[0] === 'string' && typeof k[1] === 'string' && typeof k[2] === 'string') this.known.set(k[0], { version: k[1], serverId: k[2] });
    } catch {
      /* start from the server */
    }
  }
  private saveMeta(): void {
    try {
      const current = JSON.parse(this.storage.getItem(this.keys.meta) ?? '{}') as Record<string, unknown>;
      this.storage.setItem(this.keys.meta, JSON.stringify({ ...current, scope: { enrollmentId: this.deps.scope.enrollmentId, csvId: this.deps.scope.csvId }, sync: { cursor: this.cursor, lastSyncedAt: this.lastSyncedAt, known: [...this.known].map(([id, v]) => [id, v.version, v.serverId]) } }));
    } catch {
      /* the next hydrate rebuilds it */
    }
  }

  // ---- hydration ----------------------------------------------------------------------------------------------------------------
  /**
   * First load for this enrolment. The local mirror is already on screen; this replaces it with the server's truth, keeping every pending
   * change on top. If the server cannot be reached the mirror stays exactly as it is.
   */
  async hydrate(): Promise<boolean> {
    if (!this.live) return false;
    this.publish('hydrating', null);
    const atStart = this.entitiesNow();
    try {
      const { rows, issues } = await this.deps.repo.pullAll(this.deps.scope);
      const server = toMap(rows);
      this.known = new Map(rows.map((r) => [entityId(r.table, r.key), { version: r.version, serverId: r.serverId }]));
      // Anything the student changed while the load was in flight is a pending change on top of the server's data, not something to overwrite.
      this.outbox.enqueueDiff(atStart, this.entitiesNow(), this.known, this.now());
      this.cursor = rows.reduce<string | null>((max, r) => (max === null || r.version > max ? r.version : max), null);
      // The always-present single rows (name, settings, dates): if the server did not return one, the store's own value stands.
      const local = this.entitiesNow();
      for (const [id, e] of local) if (isSingle(e.table) && !server.has(id)) server.set(id, e);
      const merged = this.withPending(server);
      this.seen = merged;
      this.applyEntities(merged);
      this.hydrated = true;
      this.lastSyncedAt = this.now();
      this.saveMeta();
      this.publish(this.outbox.size > 0 ? 'syncing' : 'idle', issues.length > 0 ? 'Some records on the server could not be read and were skipped.' : null);
      return true;
    } catch (e) {
      this.seen = this.entitiesNow(); // the mirror is the baseline: what is on screen is not a "change"
      this.hydrated = true;
      this.publish(this.online() ? 'attention' : 'offline', this.online() ? 'Could not load your latest data. Showing what is saved on this device.' : null);
      void e;
      return false;
    }
  }

  /** The server's entities with every pending op laid over them: what the student should see. */
  private withPending(server: EntityMap): EntityMap {
    const out = new Map(server);
    for (const op of this.outbox.all()) {
      if (op.kind === 'delete') out.delete(op.id);
      else if (op.row) out.set(op.id, { table: op.table, key: op.key, row: op.row });
    }
    return out;
  }

  private applyEntities(entities: EntityMap): void {
    if (!this.live) return;
    const keep = new Set<string>();
    for (const e of entities.values()) if (typeof e.row.chapter_id === 'string') keep.add(e.row.chapter_id);
    const { snapshot } = entitiesToSnapshot(entities, { ...this.deps.base(keep), officialExamDate: this.deps.officialExamDate?.() ?? null });
    this.deps.apply(snapshot);
  }

  // ---- capturing edits ----------------------------------------------------------------------------------------------------------
  /** Turns whatever changed in the store since last time into queued ops. Call after every store change. */
  capture(): void {
    if (!this.hydrated || !this.live) return;
    const current = this.entitiesNow();
    const after: EntityMap = new Map();
    for (const [id, entity] of current) {
      const problem = validateEntity(entity);
      const old = this.seen.get(id);
      if (problem === null) { after.set(id, entity); continue; }
      // A row the database would refuse for good is set aside now, not retried forever. Leave the last accepted version as the baseline.
      if (!this.deadLetters.some((d) => d.id === `${id}:${JSON.stringify(entity.row)}`)) this.deadLetter(this.opFor(entity), problem, JSON.stringify(entity.row));
      if (old) after.set(id, old);
    }
    this.outbox.enqueueDiff(this.seen, after, this.known, this.now());
    this.seen = after;
    this.publish(this.outbox.size > 0 && this.phase === 'idle' ? 'syncing' : undefined);
  }

  private opFor(entity: Entity): Op {
    return { id: entityId(entity.table, entity.key), kind: 'upsert', table: entity.table, key: entity.key, row: entity.row, isNew: !this.known.has(entityId(entity.table, entity.key)), baseVersion: null, serverId: null, queuedAt: this.now(), attempts: 0, notBefore: null, lastError: null };
  }

  private deadLetter(op: Op, reason: string, discriminator = ''): void {
    this.deadLetters = [...this.deadLetters, { id: `${op.id}:${discriminator || op.queuedAt}`, at: this.now(), op, reason }].slice(-200);
    this.writeList(this.keys.deadLetter, this.deadLetters);
  }

  // ---- sending ------------------------------------------------------------------------------------------------------------------
  /** Sends what is due. Returns true if the queue is empty afterwards. Safe to call at any time and from any tab. */
  async flush(): Promise<boolean> {
    if (!this.live || !this.hydrated || this.flushing) return this.outbox.size === 0;
    this.flushing = true;
    try {
      const ran = await this.exclusive.run(`cma-sync:${this.deps.scope.userId}`, () => this.flushLocked());
      if (ran === null) this.outbox.reload(); // another tab is sending: pick up what it leaves
      this.publish();
      return this.outbox.size === 0;
    } finally {
      this.flushing = false;
    }
  }

  private async flushLocked(): Promise<void> {
    this.outbox.reload(); // another tab may have queued changes
    this.capture();
    let refreshedOnce = false;
    for (let round = 0; round < 50; round++) {
      if (!this.online()) { this.publish('offline', null); return; }
      const batch = this.outbox.nextBatch(this.now());
      if (batch.length === 0) {
        this.publish(this.outbox.size === 0 ? 'idle' : 'syncing', null);
        if (this.outbox.size === 0) { this.lastSyncedAt = this.now(); this.saveMeta(); }
        return;
      }
      this.publish('syncing', null);
      const results = await this.deps.repo.push(this.deps.scope, batch);
      const outcome = this.settle(results);
      if (outcome === 'auth') {
        if (!refreshedOnce && this.deps.refreshSession && (await this.deps.refreshSession().catch(() => false))) { refreshedOnce = true; continue; }
        this.paused = true;
        this.publish('paused', 'Your session needs to be renewed. Sign in again to keep saving.');
        return;
      }
      if (outcome === 'offline') { this.publish('offline', null); return; }
      if (outcome === 'backoff') { this.scheduleRetry(); return; }
    }
  }

  /** Records each result. Returns what should stop the loop, if anything. */
  private settle(results: PushResult[]): 'auth' | 'offline' | 'backoff' | null {
    let stop: 'auth' | 'offline' | 'backoff' | null = null;
    const preSeen = new Map(this.seen);
    const overrides = new Map<string, Entity | null>();
    for (const r of results) {
      const { op } = r;
      if (r.status === 'applied') {
        this.outbox.remove([op.id]);
        if (op.kind === 'delete') this.known.delete(op.id);
        else if (r.serverId && r.version) this.known.set(op.id, { version: r.version, serverId: r.serverId });
        else this.known.delete(op.id); // applied but the server did not say how it looks now: forget the version so the next pull re-learns it
        if (r.version && (this.cursor === null || r.version > this.cursor)) this.cursor = r.version;
      } else if (r.status === 'conflict') {
        this.outbox.remove([op.id]);
        this.recordConflict(op, r.server);
        if (r.server) {
          this.known.set(op.id, { version: r.server.version, serverId: r.server.serverId });
          overrides.set(op.id, { table: r.server.table, key: r.server.key, row: r.server.row });
        } else {
          this.known.delete(op.id);
          overrides.set(op.id, null);
        }
      } else if (r.status === 'rejected') {
        this.outbox.remove([op.id]);
        this.deadLetter(op, r.detail);
      } else if (r.status === 'auth') {
        stop = 'auth';
      } else if (r.reason === 'offline') {
        stop ??= 'offline';
      } else {
        const attempts = op.attempts + 1;
        if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
          this.outbox.remove([op.id]);
          this.deadLetter({ ...op, attempts }, `Could not be saved after ${attempts} attempts (${r.detail}).`);
        } else {
          this.outbox.update({ ...op, attempts, lastError: r.detail, notBefore: new Date(Date.parse(this.now()) + backoffMs(attempts, this.random)).toISOString() });
          stop ??= 'backoff';
        }
      }
    }
    if (overrides.size > 0) {
      // Queue anything the student changed while the request was in flight (measured against what was captured before it), then show the
      // server's copy of each conflicted row. A row the student edited AGAIN meanwhile keeps that newer edit, queued on the server's version.
      const current = this.entitiesNow();
      this.outbox.enqueueDiff(preSeen, current, this.known, this.now());
      const merged = new Map(current);
      for (const [id, server] of overrides) {
        const editedSince = JSON.stringify(current.get(id)?.row ?? null) !== JSON.stringify(preSeen.get(id)?.row ?? null);
        if (editedSince) continue;
        if (server) merged.set(id, server);
        else merged.delete(id);
      }
      this.seen = merged;
      this.applyEntities(new Map(merged));
    }
    this.saveMeta();
    return stop;
  }

  private recordConflict(op: Op, server: ServerEntity | null): void {
    const entry: ConflictEntry = {
      id: `${op.id}@${this.now()}`, at: this.now(), table: op.table, key: op.key, mine: op.kind === 'delete' ? null : (op.row ?? null), theirs: server?.row ?? null,
      kind: server === null ? 'deleted-elsewhere' : 'changed-elsewhere',
      note: server === null ? 'This was deleted on another device; the deletion was kept.' : op.kind === 'delete' ? 'This was changed on another device, so your deletion was not applied.' : 'This was changed on another device first; the server copy was kept.',
    };
    this.conflicts = [...this.conflicts, entry].slice(-MAX_CONFLICTS);
    this.writeList(this.keys.conflicts, this.conflicts);
  }

  private scheduleRetry(): void {
    const due = this.outbox.nextDueAt();
    if (due === null) return;
    const ms = Math.max(250, Date.parse(due) - Date.parse(this.now()));
    this.later(() => void this.flush(), ms);
    this.publish('syncing', 'Will retry shortly.');
  }

  private later(fn: () => void, ms: number): void {
    const set = this.deps.setTimer ?? ((f: () => void, t: number) => setTimeout(f, t));
    this.timers.push(set(fn, ms));
  }

  // ---- pulling ------------------------------------------------------------------------------------------------------------------
  /** Fetches rows changed on the server since the last pull. Rows with a pending local change are left for the push to reconcile. */
  async pullChanges(): Promise<void> {
    if (!this.live || !this.hydrated) return;
    if (this.cursor === null) { await this.hydrate(); return; }
    if (!this.online()) return;
    // Queue the student's edits against the versions they were made on BEFORE learning newer ones, so a clash is seen as a clash.
    this.capture();
    try {
      const { rows } = await this.deps.repo.pullChanges(this.deps.scope, this.cursor);
      let changed = false;
      for (const r of rows) {
        const id = entityId(r.table, r.key);
        if (this.cursor === null || r.version > this.cursor) this.cursor = r.version;
        const have = this.known.get(id);
        if (have && have.version === r.version) continue;
        this.known.set(id, { version: r.version, serverId: r.serverId });
        if (this.outbox.has(id)) continue; // the pending change is reconciled when it is sent
        this.seen.set(id, { table: r.table, key: r.key, row: r.row });
        changed = true;
      }
      if (changed) this.applyEntities(new Map(this.seen));
      this.lastSyncedAt = this.now();
      this.saveMeta();
      this.publish(undefined, null);
    } catch {
      this.publish(this.online() ? undefined : 'offline');
    }
  }

  /** Notices rows deleted elsewhere (a pull by time cannot see a deletion) and rows missing here. Meant to run about every 30 minutes. */
  async reconcileIds(): Promise<void> {
    if (!this.live || !this.hydrated || !this.online()) return;
    this.capture();
    try {
      const onServer = await this.deps.repo.pullIds(this.deps.scope);
      const present = new Set(onServer.map((r) => entityId(r.table, r.key)));
      const missingHere = onServer.some((r) => !this.known.has(entityId(r.table, r.key)));
      let changed = false;
      for (const id of [...this.known.keys()]) {
        if (present.has(id) || this.outbox.has(id)) continue;
        this.known.delete(id);
        this.seen.delete(id);
        changed = true;
      }
      if (changed) this.applyEntities(new Map(this.seen));
      if (missingHere) await this.hydrate();
      this.saveMeta();
    } catch {
      /* try again at the next interval */
    }
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------------------------
  /** Starts the periodic work. The caller wires store changes to `capture()` + `flush()` and the browser's online/focus events to `resume()`. */
  start(): void {
    const set = this.deps.setTimer ?? ((f: () => void, t: number) => setInterval(f, t));
    this.timers.push(set(() => void this.pullChanges().then(() => this.flush()), POLL_MS));
    this.timers.push(set(() => void this.reconcileIds(), RECONCILE_MS));
  }

  /** Another tab changed the queue or the logs: pick that up so this tab's status is right. */
  refreshFromDisk(): void {
    this.outbox.reload();
    this.conflicts = this.readList(this.keys.conflicts) as ConflictEntry[];
    this.deadLetters = this.readList(this.keys.deadLetter) as DeadLetter[];
    this.publish();
  }

  /** The connection came back, the tab was focused, or the student pressed "retry". */
  async resume(): Promise<void> {
    this.paused = false;
    await this.pullChanges();
    await this.flush();
  }

  /** The session was renewed or the student signed in again after a pause. */
  unpause(): void {
    this.paused = false;
    this.publish('idle', null);
  }

  /** Sends everything, waiting for the result. For the guards before changing enrolment or signing out. */
  async flushAll(): Promise<{ ok: boolean; pending: number }> {
    this.capture();
    for (let i = 0; i < 5; i++) {
      await this.flush();
      if (this.outbox.size === 0) break;
      // ops backing off are brought forward: the student asked to leave, so waiting for the timer is not an option
      for (const op of this.outbox.all()) if (op.notBefore) this.outbox.update({ ...op, notBefore: null });
    }
    this.publish();
    return { ok: this.outbox.size === 0, pending: this.outbox.size };
  }

  dispose(): void {
    this.disposed = true;
    const clear = this.deps.clearTimer ?? ((h: unknown) => { clearTimeout(h as number); clearInterval(h as number); });
    this.timers.forEach(clear);
    this.timers = [];
  }

  // ---- conflicts and dead letters (for the student to inspect) -------------------------------------------------------------------
  getConflicts = (): ConflictEntry[] => [...this.conflicts];
  dismissConflict(id: string): void {
    this.conflicts = this.conflicts.filter((c) => c.id !== id);
    this.writeList(this.keys.conflicts, this.conflicts);
    this.publish();
  }
  getDeadLetters = (): DeadLetter[] => [...this.deadLetters];
  discardDeadLetter(id: string): void {
    this.deadLetters = this.deadLetters.filter((d) => d.id !== id);
    this.writeList(this.keys.deadLetter, this.deadLetters);
    this.publish();
  }
  /** Puts a set-aside change back in the queue (for example after the student fixed the cause). */
  retryDeadLetter(id: string): void {
    const d = this.deadLetters.find((x) => x.id === id);
    if (!d) return;
    this.outbox.put({ ...d.op, attempts: 0, notBefore: null, lastError: null });
    this.discardDeadLetter(id);
  }
  /** Everything the student might need to recover by hand, as plain data. */
  exportDiagnostics() {
    return { exportedAt: this.now(), conflicts: this.getConflicts(), setAside: this.getDeadLetters().map((d) => ({ at: d.at, table: d.op.table, key: d.op.key, reason: d.reason, row: d.op.row ?? null })), pending: this.outbox.all().map((o) => ({ table: o.table, key: o.key, kind: o.kind, attempts: o.attempts, row: o.row ?? null })) };
  }
}
