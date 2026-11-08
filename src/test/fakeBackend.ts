import { vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import { createFakeSupabase, makeSession, type FakeSupabase } from './fakeSupabase';

/**
 * An in-memory stand-in for the parts of Supabase the M7 and M8 code talks to: tables with filters, ordering and `range()` paging, the
 * `rpc()` enrolment functions, and the database rules the code relies on (ownership, unique `(user_id, client_id)`, the one-active-enrolment
 * rule, `updated_at` bumped on every write). It never touches the network and holds only obviously fake data.
 *
 * It is a TEST DOUBLE, so the rules it models are also checked against the real local database (see the integration tests), which is what
 * keeps it honest.
 */

export type Row = Record<string, unknown>;
export interface Failure { error: unknown; remaining: number }

const PERSONAL = ['chapter_progress', 'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests'];
const UNIQUE_CLIENT = ['planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests'];
const NO_DELETE = ['revisions'];

export interface FakeBackend extends FakeSupabase {
  tables: Record<string, Row[]>;
  userId: string | null;
  /** Every operation, in order. */
  calls: Array<{ table: string; op: string; filters: Array<[string, string, unknown]>; rows?: Row[] }>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  /** Make the next `times` operations on `table` (or any table with '*') fail with `error`. `op` narrows to one operation. */
  failNext: (table: string, error: unknown, times?: number, op?: string) => void;
  offline: boolean;
  /** Monotonic clock for updated_at, so tests can order writes. */
  tick: () => string;
  signInAs: (userId: string, email: string) => Session;
  rows: (table: string) => Row[];
}

const iso = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 1000).toISOString();
const networkError = () => Object.assign(new TypeError('Failed to fetch'), {});
const dbError = (code: string, message: string) => ({ code, message, name: 'PostgrestError' });
let uid = 0;
const newUuid = () => `00000000-0000-4000-8000-${String(++uid + 700_000).padStart(12, '0')}`;

export function createFakeBackend(): FakeBackend {
  const base = createFakeSupabase();
  let clock = 0;
  const failures: Array<{ table: string; op?: string; f: Failure }> = [];
  const tables: Record<string, Row[]> = {};
  const backend = base as unknown as FakeBackend;
  backend.tables = tables;
  backend.userId = null;
  backend.calls = [];
  backend.rpcCalls = [];
  backend.offline = false;
  backend.tick = () => iso(++clock);
  backend.rows = (t) => (tables[t] ??= []);
  backend.failNext = (table, error, times = 1, op) => void failures.push({ table, op, f: { error, remaining: times } });
  backend.signInAs = (userId, email) => {
    const session = makeSession(userId, email);
    backend.userId = userId;
    backend.initialSession = session;
    backend.emit('SIGNED_IN', session);
    return session;
  };
  const baseEmit = base.emit;
  backend.emit = (event, session) => {
    backend.userId = session?.user.id ?? null;
    baseEmit(event, session);
  };

  function takeFailure(table: string, op: string): unknown {
    if (backend.offline) return networkError();
    const i = failures.findIndex((x) => (x.table === table || x.table === '*') && (x.op === undefined || x.op === op) && x.f.remaining > 0);
    if (i < 0) return null;
    failures[i].f.remaining--;
    return failures[i].f.error;
  }

  type Filter = [string, string, unknown];
  const matches = (row: Row, [col, op, val]: Filter): boolean => {
    const v = row[col];
    switch (op) {
      case 'eq': return v === val;
      case 'neq': return v !== val;
      case 'in': return (val as unknown[]).includes(v);
      case 'is': return val === null ? v === null || v === undefined : v === val;
      case 'gt': return typeof v === 'string' && v > (val as string);
      case 'gte': return typeof v === 'string' && v >= (val as string);
      default: return false;
    }
  };
  const visible = (table: string, row: Row) => {
    if (!backend.userId) return false;
    if (table === 'profiles') return row.id === backend.userId;
    if (table === 'user_settings' || PERSONAL.includes(table) || table === 'student_enrollments' || table === 'enrollment_groups') return row.user_id === backend.userId;
    return true; // shared curriculum: visible to any signed-in user (published/retired filtering is done by the query, like the policy)
  };

  function from(table: string) {
    const state: { op: string; filters: Filter[]; orFilter: string | null; patch: Row | null; payload: Row[] | null; opts: Row; order: Array<[string, boolean]>; rangeTo: [number, number] | null; limit: number | null; wantRows: boolean; one: 'none' | 'maybe' | 'single' } =
      { op: 'select', filters: [], orFilter: null, patch: null, payload: null, opts: {}, order: [], rangeTo: null, limit: null, wantRows: false, one: 'none' };

    const apply = (): { data: unknown; error: unknown } => {
      const log: FakeBackend['calls'][number] = { table, op: state.op, filters: [...state.filters], rows: state.payload ?? undefined };
      backend.calls.push(log);
      base.tableCalls.push({ table, operation: state.op, filters: state.filters.map(([c, , v]) => [c, v] as [string, unknown]) });
      const injected = takeFailure(table, state.op);
      if (injected) return { data: null, error: injected };
      if (!backend.userId) return { data: null, error: dbError('42501', `permission denied for table ${table}`) };
      const rows = (tables[table] ??= []);
      const match = (r: Row) => visible(table, r) && state.filters.every((f) => matches(r, f)) && matchOr(r);
      const matchOr = (r: Row) => {
        if (!state.orFilter) return true;
        return state.orFilter.split(',').some((part) => {
          const [col, op, ...rest] = part.split('.');
          const val = rest.join('.');
          return op === 'is' ? (val === 'null' ? r[col] === null || r[col] === undefined : false) : r[col] === val;
        });
      };

      if (state.op === 'insert' || state.op === 'upsert') {
        if (!PERSONAL.includes(table)) return { data: null, error: dbError('42501', `permission denied for table ${table}`) };
        const out: Row[] = [];
        for (const raw of state.payload ?? []) {
          if (raw.user_id !== backend.userId) return { data: null, error: dbError('42501', 'new row violates row-level security policy') };
          const onConflict = String(state.opts.onConflict ?? (table === 'chapter_progress' ? 'enrollment_id,chapter_id' : 'user_id,client_id'));
          const keys = onConflict.split(',');
          const existing = rows.find((r) => keys.every((k) => r[k] === raw[k]));
          if (existing) {
            if (state.op === 'insert') return { data: null, error: dbError('23505', 'duplicate key value violates unique constraint') };
            if (state.opts.ignoreDuplicates) continue;
            Object.assign(existing, raw, { updated_at: backend.tick() });
            out.push(existing);
            continue;
          }
          if (UNIQUE_CLIENT.includes(table) && rows.some((r) => r.user_id === raw.user_id && r.client_id === raw.client_id)) return { data: null, error: dbError('23505', 'duplicate key value violates unique constraint') };
          const stamp = backend.tick();
          const row = { id: newUuid(), created_at: stamp, updated_at: stamp, ...raw };
          rows.push(row);
          out.push(row);
        }
        return { data: state.wantRows ? out : null, error: null };
      }
      if (state.op === 'update') {
        const allowed: Record<string, string[]> = {
          profiles: ['display_name', 'avatar_data_url', 'time_zone', 'onboarding_completed_at'],
          student_enrollments: ['exam_date_override', 'final_revision_date'],
          user_settings: ['daily_target_hours', 'weekly_target_hours', 'study_start_time', 'study_end_time', 'pomodoro_focus_minutes', 'short_break_minutes', 'long_break_minutes', 'long_break_every', 'theme'],
        };
        const immutable = ['id', 'user_id', 'enrollment_id', 'csv_id', 'chapter_id', 'client_id', 'created_at'];
        for (const col of Object.keys(state.patch ?? {})) {
          if (PERSONAL.includes(table) ? immutable.includes(col) : !(allowed[table] ?? []).includes(col)) return { data: null, error: dbError('42501', `permission denied for column ${col}`) };
        }
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, state.patch, { updated_at: backend.tick() });
        return { data: state.wantRows ? hit : null, error: null };
      }
      if (state.op === 'delete') {
        if (!PERSONAL.includes(table) || NO_DELETE.includes(table)) return { data: null, error: dbError('42501', `permission denied for table ${table}`) };
        const hit = rows.filter(match);
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: state.wantRows ? hit : null, error: null };
      }
      // select
      let result = rows.filter(match).map((r) => ({ ...r }));
      for (const [col, asc] of [...state.order].reverse()) {
        result = [...result].sort((a, b) => {
          const x = a[col] as string | number; const y = b[col] as string | number;
          return (x === y ? 0 : x < y ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (state.rangeTo) result = result.slice(state.rangeTo[0], state.rangeTo[1] + 1);
      if (state.limit !== null) result = result.slice(0, state.limit);
      if (state.one === 'none') return { data: result, error: null };
      if (result.length > 1) return { data: null, error: dbError('PGRST116', 'multiple rows') };
      if (result.length === 0 && state.one === 'single') return { data: null, error: dbError('PGRST116', 'no rows') };
      return { data: result[0] ?? null, error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => { state.wantRows = true; return chain; },
      insert: (payload: Row | Row[]) => { state.op = 'insert'; state.payload = Array.isArray(payload) ? payload : [payload]; return chain; },
      upsert: (payload: Row | Row[], opts: Row = {}) => { state.op = 'upsert'; state.payload = Array.isArray(payload) ? payload : [payload]; state.opts = opts; return chain; },
      update: (patch: Row) => { state.op = 'update'; state.patch = patch; return chain; },
      delete: () => { state.op = 'delete'; return chain; },
      eq: (c: string, v: unknown) => { state.filters.push([c, 'eq', v]); return chain; },
      neq: (c: string, v: unknown) => { state.filters.push([c, 'neq', v]); return chain; },
      in: (c: string, v: unknown[]) => { state.filters.push([c, 'in', v]); return chain; },
      is: (c: string, v: unknown) => { state.filters.push([c, 'is', v]); return chain; },
      gt: (c: string, v: unknown) => { state.filters.push([c, 'gt', v]); return chain; },
      gte: (c: string, v: unknown) => { state.filters.push([c, 'gte', v]); return chain; },
      or: (expr: string) => { state.orFilter = expr; return chain; },
      order: (c: string, o: { ascending?: boolean } = {}) => { state.order.push([c, o.ascending !== false]); return chain; },
      range: (a: number, b: number) => { state.rangeTo = [a, b]; return chain; },
      limit: (n: number) => { state.limit = n; return chain; },
      maybeSingle: () => { state.one = 'maybe'; return Promise.resolve().then(apply); },
      single: () => { state.one = 'single'; return Promise.resolve().then(apply); },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(apply).then(resolve, reject),
    };
    return chain;
  }

  // ---- the enrolment functions (the rules the real database enforces) -------------------------------------------------------------
  const enrolments = () => backend.rows('student_enrollments');
  const mine = () => enrolments().filter((e) => e.user_id === backend.userId);
  const optionRows = () => backend.rows('enrollment_options');
  function rpc(name: string, args: Record<string, unknown>) {
    backend.rpcCalls.push({ name, args });
    return Promise.resolve().then((): { data: unknown; error: unknown } => {
      const injected = takeFailure(`rpc:${name}`, 'rpc');
      if (injected) return { data: null, error: injected };
      if (!backend.userId) return { data: null, error: { code: '28000', message: 'not signed in' } };
      const stamp = backend.tick();
      const groupsOf = (csv: string) => optionRows().filter((o) => o.csv_id === csv).flatMap((o) => o.groups as Array<{ id: string }>).map((g) => g.id);
      const own = (id: unknown) => mine().find((e) => e.id === id);
      const setGroups = (e: Row, ids: string[]) => {
        const rows = backend.rows('enrollment_groups');
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].enrollment_id === e.id) rows.splice(i, 1);
        for (const g of ids) rows.push({ enrollment_id: e.id, subject_group_id: g, user_id: e.user_id, csv_id: e.csv_id });
      };
      if (name === 'create_enrollment') {
        const csv = String(args.p_csv_id); const attempt = String(args.p_attempt_id); const ids = (args.p_group_ids as string[]) ?? [];
        if (ids.length === 0) return { data: null, error: { code: '22023', message: 'choose at least one group' } };
        if (new Set(ids).size !== ids.length) return { data: null, error: { code: '22023', message: 'groups must be distinct and not null' } };
        const option = optionRows().find((o) => o.csv_id === csv && o.exam_attempt_id === attempt);
        if (!option) return { data: null, error: { code: '23514', message: 'this combination is not available for enrolment' } };
        const published = new Set((option.groups as Array<{ id: string }>).map((g) => g.id));
        if (!ids.every((g) => published.has(g))) return { data: null, error: { code: '23514', message: 'every group must be a published group of this course and syllabus' } };
        const active = mine().find((e) => e.status === 'active');
        if (active && !args.p_replace_active) return { data: null, error: { code: '23505', message: 'you already have an active enrolment' } };
        if (active) Object.assign(active, { status: 'archived', archived_at: stamp, updated_at: stamp });
        const row: Row = { id: newUuid(), user_id: backend.userId, csv_id: csv, exam_attempt_id: attempt, status: 'active', exam_date_override: null, final_revision_date: null, started_at: stamp, archived_at: null, created_at: stamp, updated_at: stamp };
        enrolments().push(row);
        setGroups(row, ids);
        return { data: row.id, error: null };
      }
      const e = own(args.p_enrollment_id);
      if (!e) return { data: null, error: { code: 'P0002', message: 'enrolment not found' } };
      if (name === 'change_enrollment_attempt') {
        if (e.status !== 'active') return { data: null, error: { code: '23514', message: 'only the active enrolment can change attempt' } };
        const option = optionRows().find((o) => o.csv_id === e.csv_id && o.exam_attempt_id === args.p_attempt_id);
        if (!option) return { data: null, error: { code: '23514', message: 'this combination is not available for enrolment' } };
        Object.assign(e, { exam_attempt_id: args.p_attempt_id, updated_at: stamp }, args.p_clear_dates === false ? {} : { exam_date_override: null, final_revision_date: null });
        return { data: null, error: null };
      }
      if (name === 'set_enrollment_groups') {
        const ids = (args.p_group_ids as string[]) ?? [];
        if (ids.length === 0) return { data: null, error: { code: '22023', message: 'choose at least one group' } };
        if (!ids.every((g) => groupsOf(String(e.csv_id)).includes(g))) return { data: null, error: { code: '23514', message: 'every group must be a published group of this course and syllabus' } };
        setGroups(e, ids);
        e.updated_at = stamp;
        return { data: null, error: null };
      }
      if (name === 'archive_enrollment') { Object.assign(e, { status: 'archived', archived_at: stamp, updated_at: stamp }); return { data: null, error: null }; }
      if (name === 'activate_enrollment') {
        const active = mine().find((x) => x.status === 'active');
        if (active && active !== e) Object.assign(active, { status: 'archived', archived_at: stamp, updated_at: stamp });
        Object.assign(e, { status: 'active', archived_at: null, updated_at: stamp });
        return { data: null, error: null };
      }
      return { data: null, error: { code: '42883', message: `function ${name} does not exist` } };
    });
  }

  backend.client = { auth: base.auth, from, rpc } as unknown as AppSupabaseClient;
  vi.fn();
  return backend;
}
