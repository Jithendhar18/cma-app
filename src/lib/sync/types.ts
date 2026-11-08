/**
 * The synchronisation model.
 *
 * The app keeps its familiar snapshot (`StudyDataSnapshot`). For syncing, that snapshot is cut into ENTITIES: one per row of a personal
 * table, in a client form that has no server id, owner or enrolment (those are added at the network edge). Everything between the snapshot
 * and the network (diffing, the outbox, conflicts) works on entities, so it is plain data that can be compared and stored.
 */
export const TABLES = ['planner_sessions', 'chapter_progress', 'revisions', 'study_sessions', 'practice_records', 'mock_tests'] as const;
export type PersonalTable = (typeof TABLES)[number];

/**
 * Single-row account records: the student's display name (`profiles`), their settings (`user_settings`) and their own exam and final-revision
 * dates (`student_enrollments`). They always exist, are only ever UPDATED (never inserted or deleted by the client), and only their
 * student-editable columns travel. Their key is always `self`.
 */
export const SINGLE_TABLES = ['profiles', 'user_settings', 'student_enrollments'] as const;
export type SingleTable = (typeof SINGLE_TABLES)[number];
export const isSingle = (t: Table): t is SingleTable => (SINGLE_TABLES as readonly string[]).includes(t);

export type Table = PersonalTable | SingleTable;

/** Parents before children: a focus record may point at a planned session, so planned sessions are written first (and deleted last). */
export const WRITE_ORDER: Record<Table, number> = { planner_sessions: 0, chapter_progress: 1, revisions: 2, study_sessions: 3, practice_records: 4, mock_tests: 5, profiles: 6, user_settings: 7, student_enrollments: 8 };

export type EntityRow = Record<string, string | number | null>;

export interface Entity {
  table: Table;
  /** What identifies the row for this user and enrolment: the chapter for progress, otherwise the client id. */
  key: string;
  row: EntityRow;
}

export type EntityMap = Map<string, Entity>;
export const entityId = (table: Table, key: string): string => `${table}:${key}`;
export const toMap = (entities: Iterable<Entity>): EntityMap => new Map([...entities].map((e) => [entityId(e.table, e.key), e]));

/** A row as the server holds it, with the version that conditional writes compare. */
export interface ServerEntity extends Entity {
  /** The server's own row id (uuid). */
  serverId: string;
  /** `updated_at` as the server last set it. */
  version: string;
}

export type OpKind = 'upsert' | 'delete';

/** One change waiting to be sent. Persisted, so it survives a reload, a crash and being offline. */
export interface Op {
  /** Identity of the entity this op is about; at most one op per entity is ever queued (they are coalesced). */
  id: string;
  kind: OpKind;
  table: Table;
  key: string;
  /** The row to write (upsert only). */
  row?: EntityRow;
  /** True when the server has never been told about this row (so it is an insert, not an update). */
  isNew: boolean;
  /** The server version this change was made on top of. A conditional write only applies if the row is still at this version. */
  baseVersion: string | null;
  /** Server uuid of the row, when known. */
  serverId: string | null;
  queuedAt: string;
  attempts: number;
  /** When a failing op may be tried again. */
  notBefore: string | null;
  lastError: string | null;
}

export type PushResult =
  | { op: Op; status: 'applied'; serverId: string | null; version: string | null }
  | { op: Op; status: 'conflict'; server: ServerEntity | null }
  | { op: Op; status: 'retry'; reason: 'offline' | 'transient'; detail: string }
  | { op: Op; status: 'auth' }
  | { op: Op; status: 'rejected'; detail: string };

export interface Scope {
  userId: string;
  enrollmentId: string;
  csvId: string;
}

export type PullIssue = { table: Table; id: string; problem: string };

export interface PersonalRepository {
  /** Every row of this enrolment, paged explicitly, malformed rows skipped and reported. */
  pullAll(scope: Scope): Promise<{ rows: ServerEntity[]; issues: PullIssue[] }>;
  /**
   * Rows changed since `since` (an `updated_at` cursor). `known` maps entity ids to the versions already held, so unchanged rows are not
   * read in full again. Cannot see deletions: that is `pullIds`' job.
   */
  pullChanges(scope: Scope, since: string, known?: ReadonlyMap<string, string>): Promise<{ rows: ServerEntity[]; issues: PullIssue[] }>;
  /** The ids that exist on the server now, so rows deleted elsewhere can be noticed. */
  pullIds(scope: Scope): Promise<Array<{ table: Table; key: string; version: string }>>;
  /** Sends ops in the order given. Never throws for a per-op outcome. */
  push(scope: Scope, ops: Op[]): Promise<PushResult[]>;
  /** How many requests this repository has made so far (diagnostics only). */
  requestCount?(): number;
}

export type SyncPhase = 'idle' | 'hydrating' | 'syncing' | 'offline' | 'attention' | 'paused';

export interface ConflictEntry {
  id: string;
  at: string;
  table: Table;
  key: string;
  /** What this device tried to save. */
  mine: EntityRow | null;
  /** What the server had (kept: server wins). */
  theirs: EntityRow | null;
  kind: 'changed-elsewhere' | 'deleted-elsewhere' | 'rejected';
  note: string;
}

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  deadLettered: number;
  conflicts: number;
  lastSyncedAt: string | null;
  /** Plain-words reason when phase is 'attention' or 'paused'. */
  message: string | null;
}

/** Lightweight counters for troubleshooting. Counts and times only: never study content, names, tokens or ids. */
export interface SyncDiagnostics {
  queued: number;
  setAside: number;
  conflictsLogged: number;
  flushes: number;
  batches: number;
  opsSent: number;
  applied: number;
  conflictsResolved: number;
  rejected: number;
  retried: number;
  /** Requests made to the data API since this session's engine started (reads and writes). */
  requests: number;
  lastBatch: { ops: number; requests: number; ms: number } | null;
  lastSyncedAt: string | null;
}
