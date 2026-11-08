import type { AppSupabaseClient } from '@/lib/supabase/client';
import { fetchAllPages, PagingError } from '@/lib/curriculum/paging';
import { same } from './diff';
import { classifyFailure } from './errors';
import { entityId, isSingle, SINGLE_TABLES, TABLES, type Entity, type EntityRow, type Op, type PersonalRepository, type PersonalTable, type PullIssue, type PushResult, type Scope, type ServerEntity, type SingleTable, type Table } from './types';

type Row = Record<string, unknown>;
interface Result { data: unknown; error: unknown }
/** The little of the query builder this file uses. The generated types cannot follow a table name chosen at run time. */
interface Query extends PromiseLike<Result> {
  select(columns?: string): Query;
  insert(values: Row): Query;
  update(values: Row): Query;
  delete(): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): PromiseLike<Result>;
}
interface Loose { from(table: string): Query }

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const dateOnly = (v: string) => v.slice(0, 10);
const orNull = (v: unknown): string | null => (typeof v === 'string' ? dateOnly(v) : null);

/** Columns the browser may change after a row exists (the others are fixed at creation by the database). */
const MUTABLE: Record<PersonalTable, string[]> = {
  chapter_progress: ['status', 'confidence', 'notes', 'completed_on'],
  planner_sessions: ['planned_date', 'start_time', 'duration_minutes', 'status', 'priority', 'notes'],
  study_sessions: ['local_date', 'minutes', 'mode', 'notes', 'planner_session_id'],
  revisions: ['revision_number', 'due_date', 'completed_on', 'cancelled_on', 'priority'],
  practice_records: ['local_date', 'questions', 'correct'],
  mock_tests: ['taken_on', 'name', 'score', 'max_score'],
};

/** Server row -> entity, or a problem. Anything not exactly as expected is reported and skipped, never guessed at. */
export function fromWire(table: Table, r: Row, plannerClientById: ReadonlyMap<string, string>): { entity: Entity; serverId: string; version: string } | { problem: string } {
  if (table === 'user_settings' && isString(r.user_id)) r = { ...r, id: r.user_id };
  if (!isString(r.id) || !isString(r.updated_at)) return { problem: 'missing id or version' };
  const base = { serverId: r.id, version: r.updated_at };
  const ok = (key: string, row: EntityRow) => ({ ...base, entity: { table, key, row } as Entity });
  switch (table) {
    case 'profiles':
      if (typeof r.display_name !== 'string') return { problem: 'malformed profile' };
      return { serverId: String(r.id), version: String(r.updated_at), entity: { table, key: 'self', row: { display_name: r.display_name } } };
    case 'user_settings': {
      const n = [r.daily_target_hours, r.weekly_target_hours, r.pomodoro_focus_minutes, r.short_break_minutes, r.long_break_minutes, r.long_break_every];
      if (!n.every(isNum) || typeof r.study_start_time !== 'string' || typeof r.study_end_time !== 'string' || !['dark', 'light', 'system'].includes(String(r.theme))) return { problem: 'malformed settings' };
      return { serverId: String(r.id), version: String(r.updated_at), entity: { table, key: 'self', row: { daily_target_hours: r.daily_target_hours as number, weekly_target_hours: r.weekly_target_hours as number, study_start_time: r.study_start_time.slice(0, 5), study_end_time: r.study_end_time.slice(0, 5), pomodoro_focus_minutes: r.pomodoro_focus_minutes as number, short_break_minutes: r.short_break_minutes as number, long_break_minutes: r.long_break_minutes as number, long_break_every: r.long_break_every as number, theme: r.theme as string } } };
    }
    case 'student_enrollments':
      return { serverId: String(r.id), version: String(r.updated_at), entity: { table, key: 'self', row: { exam_date_override: orNull(r.exam_date_override), final_revision_date: orNull(r.final_revision_date) } } };
    case 'chapter_progress':
      if (!isString(r.chapter_id) || !isString(r.status) || !isInt(r.confidence) || typeof r.notes !== 'string') return { problem: 'malformed chapter progress' };
      return ok(r.chapter_id, { chapter_id: r.chapter_id, status: r.status, confidence: r.confidence, notes: r.notes, completed_on: orNull(r.completed_on) });
    case 'planner_sessions':
      if (!isString(r.client_id) || !isString(r.chapter_id) || !isDate(r.planned_date) || !isString(r.start_time) || !isInt(r.duration_minutes) || !isString(r.status) || !isString(r.priority) || typeof r.notes !== 'string') return { problem: 'malformed planned session' };
      return ok(r.client_id, { client_id: r.client_id, chapter_id: r.chapter_id, planned_date: dateOnly(r.planned_date), start_time: r.start_time.slice(0, 5), duration_minutes: r.duration_minutes, status: r.status, priority: r.priority, notes: r.notes });
    case 'study_sessions': {
      if (!isString(r.client_id) || !isString(r.chapter_id) || !isDate(r.local_date) || !isInt(r.minutes) || !isString(r.mode) || typeof r.notes !== 'string') return { problem: 'malformed focus record' };
      const planner = isString(r.planner_session_id) ? (plannerClientById.get(r.planner_session_id) ?? null) : null;
      return ok(r.client_id, { client_id: r.client_id, chapter_id: r.chapter_id, local_date: dateOnly(r.local_date), minutes: r.minutes, mode: r.mode, notes: r.notes, planner_client_id: planner });
    }
    case 'revisions':
      if (!isString(r.client_id) || !isString(r.chapter_id) || !isInt(r.revision_number) || !isDate(r.due_date) || !isString(r.priority)) return { problem: 'malformed revision' };
      return ok(r.client_id, { client_id: r.client_id, chapter_id: r.chapter_id, revision_number: r.revision_number, due_date: dateOnly(r.due_date), completed_on: orNull(r.completed_on), cancelled_on: orNull(r.cancelled_on), priority: r.priority });
    case 'practice_records':
      if (!isString(r.client_id) || !isString(r.chapter_id) || !isDate(r.local_date) || !isInt(r.questions) || !isInt(r.correct)) return { problem: 'malformed practice record' };
      return ok(r.client_id, { client_id: r.client_id, chapter_id: r.chapter_id, local_date: dateOnly(r.local_date), questions: r.questions, correct: r.correct });
    case 'mock_tests':
      if (!isString(r.client_id) || !isString(r.subject_id) || !isDate(r.taken_on) || !isString(r.name) || !isNum(r.score) || !isNum(r.max_score)) return { problem: 'malformed mock test' };
      return ok(r.client_id, { client_id: r.client_id, subject_id: r.subject_id, taken_on: dateOnly(r.taken_on), name: r.name, score: r.score, max_score: r.max_score });
  }
}

/** Entity -> the columns to send. The owner, enrolment and syllabus come from the scope, never from the entity. */
function toWire(entity: Entity, scope: Scope, plannerServerId: string | null): Row {
  const { planner_client_id: _link, ...row } = entity.row;
  void _link;
  const out: Row = { ...row, user_id: scope.userId, enrollment_id: scope.enrollmentId, csv_id: scope.csvId };
  if (entity.table === 'planner_sessions') out.start_time = `${String(row.start_time).slice(0, 5)}:00`;
  if (entity.table === 'study_sessions') out.planner_session_id = plannerServerId;
  return out;
}

const singleKey = (table: SingleTable, scope: Scope): { col: string; val: string } =>
  table === 'profiles' ? { col: 'id', val: scope.userId } : table === 'user_settings' ? { col: 'user_id', val: scope.userId } : { col: 'id', val: scope.enrollmentId };

/** Exactly the columns the database lets the browser change on these tables: nothing else is ever sent. */
function singlePatch(entity: Entity): Row {
  const r = entity.row;
  if (entity.table === 'profiles') return { display_name: r.display_name };
  if (entity.table === 'student_enrollments') return { exam_date_override: r.exam_date_override, final_revision_date: r.final_revision_date };
  return {
    daily_target_hours: r.daily_target_hours, weekly_target_hours: r.weekly_target_hours, study_start_time: `${String(r.study_start_time).slice(0, 5)}:00`, study_end_time: `${String(r.study_end_time).slice(0, 5)}:00`,
    pomodoro_focus_minutes: r.pomodoro_focus_minutes, short_break_minutes: r.short_break_minutes, long_break_minutes: r.long_break_minutes, long_break_every: r.long_break_every, theme: r.theme,
  };
}

const pick = (row: Row, cols: string[]): Row => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
const errorOf = (e: unknown) => (e instanceof PagingError ? e.cause : e);

/**
 * Personal data through the browser's own, row-level-secured access. Every statement is scoped to the signed-in user by the database; the
 * `enrollment_id` filters here narrow reads to the active enrolment and are not what protects anyone's data.
 */
export class SupabasePersonal implements PersonalRepository {
  private readonly db: Loose;
  /** Server uuid of each planned session by its client id, so a focus record can point at it. */
  private readonly plannerServerId = new Map<string, string>();

  constructor(client: AppSupabaseClient) {
    this.db = client as unknown as Loose;
  }

  private async readTable(table: PersonalTable, scope: Scope, since: string | null): Promise<Row[]> {
    try {
      return await fetchAllPages<Row>((from, to) => {
        let q = this.db.from(table).select('*').eq('enrollment_id', scope.enrollmentId);
        if (since !== null) q = q.gte('updated_at', since);
        return q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, to) as PromiseLike<{ data: Row[] | null; error: unknown }>;
      });
    } catch (e) {
      throw errorOf(e);
    }
  }

  /** The always-present single rows (name, settings, enrolment dates). Not paged: each is one row. */
  private async readSingle(table: SingleTable, scope: Scope, since: string | null): Promise<Row[]> {
    let q = this.db.from(table).select('*').eq(singleKey(table, scope).col, singleKey(table, scope).val);
    if (since !== null) q = q.gte('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    return Array.isArray(data) ? (data as Row[]) : [];
  }

  private async pull(scope: Scope, since: string | null): Promise<{ rows: ServerEntity[]; issues: PullIssue[] }> {
    const issues: PullIssue[] = [];
    const rows: ServerEntity[] = [];
    const plannerClientById = new Map<string, string>();
    for (const table of TABLES) {
      const raw = await this.readTable(table, scope, since);
      if (table === 'planner_sessions') for (const r of raw) if (isString(r.id) && isString(r.client_id)) { plannerClientById.set(r.id, r.client_id); this.plannerServerId.set(r.client_id, r.id); }
      for (const r of raw) {
        const parsed = fromWire(table, r, plannerClientById);
        if ('problem' in parsed) issues.push({ table, id: String(r.id ?? '?'), problem: parsed.problem });
        else rows.push({ ...parsed.entity, serverId: parsed.serverId, version: parsed.version });
      }
    }
    for (const table of SINGLE_TABLES) {
      for (const r of await this.readSingle(table, scope, since)) {
        const parsed = fromWire(table, r, plannerClientById);
        if ('problem' in parsed) issues.push({ table, id: String(r.id ?? r.user_id ?? '?'), problem: parsed.problem });
        else rows.push({ ...parsed.entity, serverId: parsed.serverId, version: parsed.version });
      }
    }
    return { rows, issues };
  }

  pullAll(scope: Scope) {
    return this.pull(scope, null);
  }
  pullChanges(scope: Scope, since: string) {
    return this.pull(scope, since);
  }

  async pullIds(scope: Scope): Promise<Array<{ table: Table; key: string; version: string }>> {
    const out: Array<{ table: Table; key: string; version: string }> = [];
    for (const table of TABLES) {
      const raw = await this.readTable(table, scope, null);
      for (const r of raw) {
        const key = table === 'chapter_progress' ? r.chapter_id : r.client_id;
        if (isString(key) && isString(r.updated_at)) out.push({ table, key, version: r.updated_at });
      }
    }
    for (const table of SINGLE_TABLES) {
      for (const r of await this.readSingle(table, scope, null)) if (isString(r.updated_at)) out.push({ table, key: 'self', version: r.updated_at });
    }
    return out;
  }

  // ---- writes -------------------------------------------------------------------------------------------------------------------
  async push(scope: Scope, ops: Op[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    let stop: PushResult['status'] | null = null;
    for (const op of ops) {
      // After an auth or offline failure the rest would fail the same way: leave them queued, untouched.
      if (stop === 'auth') { results.push({ op, status: 'auth' }); continue; }
      if (stop === 'retry') { results.push({ op, status: 'retry', reason: 'offline', detail: 'offline' }); continue; }
      const result = await this.pushOne(scope, op);
      results.push(result);
      if (result.status === 'auth') stop = 'auth';
      else if (result.status === 'retry' && result.reason === 'offline') stop = 'retry';
    }
    return results;
  }

  private fail(op: Op, error: unknown): PushResult {
    const { kind, detail } = classifyFailure(error);
    if (kind === 'offline') return { op, status: 'retry', reason: 'offline', detail };
    if (kind === 'transient') return { op, status: 'retry', reason: 'transient', detail };
    if (kind === 'auth') return { op, status: 'auth' };
    return { op, status: 'rejected', detail: kind === 'quota' ? 'Your account has reached its limit for this kind of record.' : `The server refused this change (${detail}).` };
  }

  private keyFilter(q: Query, op: Op, scope: Scope): Query {
    const col = op.table === 'chapter_progress' ? 'chapter_id' : 'client_id';
    return q.eq('enrollment_id', scope.enrollmentId).eq(col, op.key);
  }

  /** The row the server holds for this entity now (or null), with its version. */
  private async fetchServer(scope: Scope, op: Op): Promise<{ server: ServerEntity | null } | { error: unknown }> {
    const { data, error } = await this.keyFilter(this.db.from(op.table).select('*'), op, scope).maybeSingle();
    if (error) return { error };
    if (!data) return { server: null };
    const planner = new Map<string, string>();
    if (op.table === 'study_sessions' && isString((data as Row).planner_session_id)) {
      for (const [client, id] of this.plannerServerId) planner.set(id, client);
    }
    const parsed = fromWire(op.table, data as Row, planner);
    if ('problem' in parsed) return { error: new Error(parsed.problem) };
    return { server: { ...parsed.entity, serverId: parsed.serverId, version: parsed.version } };
  }

  private async resolvePlanner(scope: Scope, op: Op): Promise<{ id: string | null } | { error: unknown }> {
    const link = op.row?.planner_client_id;
    if (typeof link !== 'string') return { id: null };
    const cached = this.plannerServerId.get(link);
    if (cached) return { id: cached };
    const { data, error } = await this.db.from('planner_sessions').select('id').eq('enrollment_id', scope.enrollmentId).eq('client_id', link).maybeSingle();
    if (error) return { error };
    const id = data && isString((data as Row).id) ? ((data as Row).id as string) : null;
    if (id) this.plannerServerId.set(link, id);
    return { id };
  }

  private async pushOne(scope: Scope, op: Op): Promise<PushResult> {
    try {
      if (isSingle(op.table)) return await this.pushSingle(scope, op, op.table);
      if (op.kind === 'delete') return await this.pushDelete(scope, op);
      return op.isNew ? await this.pushInsert(scope, op) : await this.pushUpdate(scope, op);
    } catch (e) {
      return this.fail(op, e);
    }
  }

  /**
   * Name, settings and the student's own dates are only ever UPDATED, through the columns the database grants the browser, on the version the
   * edit was based on. Nothing identifies the row but the signed-in user and the scope (never the entity), and no other column can be sent.
   */
  private async pushSingle(scope: Scope, op: Op, table: SingleTable): Promise<PushResult> {
    if (op.kind === 'delete') return { op, status: 'rejected', detail: 'This record is never deleted.' };
    const entity: Entity = { table, key: op.key, row: op.row ?? {} };
    const { col, val } = singleKey(table, scope);
    let q = this.db.from(table).update(singlePatch(entity)).eq(col, val);
    if (op.baseVersion) q = q.eq('updated_at', op.baseVersion);
    const { data, error } = await q.select('*');
    if (error) return this.fail(op, error);
    const hit = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
    if (hit && isString(hit.updated_at)) return { op, status: 'applied', serverId: String(hit.id ?? hit.user_id), version: hit.updated_at };
    const { data: now, error: readError } = await this.db.from(table).select('*').eq(col, val).maybeSingle();
    if (readError) return this.fail(op, readError);
    if (!now) return { op, status: 'conflict', server: null };
    const parsed = fromWire(table, now as Row, new Map());
    if ('problem' in parsed) return this.fail(op, new Error(parsed.problem));
    const server: ServerEntity = { ...parsed.entity, serverId: parsed.serverId, version: parsed.version };
    return same(server.row, entity.row) ? { op, status: 'applied', serverId: server.serverId, version: server.version } : { op, status: 'conflict', server };
  }

  private async pushInsert(scope: Scope, op: Op): Promise<PushResult> {
    const entity: Entity = { table: op.table, key: op.key, row: op.row ?? {} };
    const link = await this.resolvePlanner(scope, op);
    if ('error' in link) return this.fail(op, link.error);
    // A focus record whose planned session is not on the server yet waits for it (the session is sent first, so this means it failed).
    if (op.table === 'study_sessions' && typeof op.row?.planner_client_id === 'string' && link.id === null) return { op, status: 'retry', reason: 'transient', detail: 'waiting for the planned session' };
    const { data, error } = await this.db.from(op.table).insert(toWire(entity, scope, link.id)).select('*');
    if (!error) {
      const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
      if (row && isString(row.id) && isString(row.updated_at)) {
        if (op.table === 'planner_sessions') this.plannerServerId.set(op.key, row.id);
        return { op, status: 'applied', serverId: row.id, version: row.updated_at };
      }
      return { op, status: 'applied', serverId: null, version: null };
    }
    // The row already exists: a retry whose first answer was lost, or another device made it. Same content = done; different = a conflict.
    if ((error as { code?: string }).code === '23505') {
      const found = await this.fetchServer(scope, op);
      if ('error' in found) return this.fail(op, found.error);
      if (found.server && same(found.server.row, entity.row)) return { op, status: 'applied', serverId: found.server.serverId, version: found.server.version };
      return { op, status: 'conflict', server: found.server };
    }
    return this.fail(op, error);
  }

  private async pushUpdate(scope: Scope, op: Op): Promise<PushResult> {
    const entity: Entity = { table: op.table, key: op.key, row: op.row ?? {} };
    const link = await this.resolvePlanner(scope, op);
    if ('error' in link) return this.fail(op, link.error);
    const patch = pick(toWire(entity, scope, link.id), MUTABLE[op.table as PersonalTable]);
    let q = this.db.from(op.table).update(patch).eq('enrollment_id', scope.enrollmentId);
    q = op.serverId ? q.eq('id', op.serverId) : this.keyFilter(q, op, scope);
    if (op.baseVersion) q = q.eq('updated_at', op.baseVersion);
    const { data, error } = await q.select('*');
    if (error) return this.fail(op, error);
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
    if (row && isString(row.id) && isString(row.updated_at)) return { op, status: 'applied', serverId: row.id, version: row.updated_at };
    // Nothing matched: the row is gone or has been changed since this edit was based on it.
    const found = await this.fetchServer(scope, op);
    if ('error' in found) return this.fail(op, found.error);
    if (found.server && same(found.server.row, entity.row)) return { op, status: 'applied', serverId: found.server.serverId, version: found.server.version };
    return { op, status: 'conflict', server: found.server };
  }

  private async pushDelete(scope: Scope, op: Op): Promise<PushResult> {
    if (op.table === 'revisions') return { op, status: 'rejected', detail: 'Revisions are cancelled, never deleted.' };
    let q = this.db.from(op.table).delete().eq('enrollment_id', scope.enrollmentId);
    q = op.serverId ? q.eq('id', op.serverId) : this.keyFilter(q, op, scope);
    if (op.baseVersion) q = q.eq('updated_at', op.baseVersion);
    const { data, error } = await q.select('*');
    if (error) return this.fail(op, error);
    if (Array.isArray(data) && data.length > 0) return { op, status: 'applied', serverId: op.serverId, version: null };
    const found = await this.fetchServer(scope, op);
    if ('error' in found) return this.fail(op, found.error);
    return found.server ? { op, status: 'conflict', server: found.server } : { op, status: 'applied', serverId: op.serverId, version: null };
  }
}

export { entityId };
