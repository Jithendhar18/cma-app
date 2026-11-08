import { vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { AuthConfig } from '@/lib/supabase/config';

/**
 * A stand-in for the Supabase client used by every account test. It never touches the network and holds no real credentials:
 * every email ends in .test or .invalid and every token is an obvious placeholder.
 *
 * It records each table operation so tests can prove the browser only ever READS profiles and user_settings, and it can emit
 * auth events exactly as the SDK does (including a sign-out that arrives from another tab).
 */

export type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY';
type Listener = (event: AuthEvent, session: Session | null) => void;

export const ENABLED_CONFIG: Extract<AuthConfig, { status: 'enabled' }> = {
  status: 'enabled',
  url: 'https://placeholder-project.supabase.co',
  anonKey: 'placeholder-public-key',
};

export function makeSession(id: string, email: string): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id, email, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  } as Session;
}

export const profileRow = (id: string, displayName: string) => ({ id, display_name: displayName, time_zone: 'Asia/Kolkata', onboarding_completed_at: null });
export const settingsRow = () => ({
  daily_target_hours: 8, weekly_target_hours: 50, study_start_time: '06:00:00', study_end_time: '23:00:00',
  pomodoro_focus_minutes: 50, short_break_minutes: 10, long_break_minutes: 20, long_break_every: 4, theme: 'dark',
});

type Row = Record<string, unknown> | null;
type QueryResult = { data: Row; error: unknown };
export interface TableCall { table: string; operation: string; filters: Array<[string, unknown]> }

export interface FakeSupabase {
  client: AppSupabaseClient;
  /** Emit an auth event to every subscribed listener, as the SDK does (also how a sign-out in another tab arrives). */
  emit: (event: AuthEvent, session: Session | null) => void;
  /** Session the fake reports to a new subscriber as INITIAL_SESSION. Set before the provider starts. */
  initialSession: Session | null;
  listenerCount: () => number;
  auth: Record<string, ReturnType<typeof vi.fn>>;
  tableCalls: TableCall[];
  /** Per-user rows the fake serves. A query returns the row whose id / user_id matches the filter, like RLS plus the filter. */
  profiles: Map<string, Row>;
  settings: Map<string, Row>;
  /** Let a test hold a query open and release it later, to create an out-of-order (stale) response. */
  holdProfileFor: (userId: string) => () => void;
  failTablesWith: (error: unknown) => void;
}

export function createFakeSupabase(): FakeSupabase {
  const listeners = new Set<Listener>();
  const tableCalls: TableCall[] = [];
  const profiles = new Map<string, Row>();
  const settings = new Map<string, Row>();
  const held = new Map<string, Promise<void>>();
  let tableError: unknown = null;
  // The session the SDK would report right now. Undefined until an event changes it, so tests can set `initialSession` first.
  let current: Session | null | undefined;

  const fake: FakeSupabase = {
    client: undefined as unknown as AppSupabaseClient,
    initialSession: null,
    emit: (event, session) => {
      if (event !== 'INITIAL_SESSION') current = session;
      listeners.forEach((l) => l(event, session));
    },
    listenerCount: () => listeners.size,
    auth: {},
    tableCalls,
    profiles,
    settings,
    holdProfileFor: (userId) => {
      let release!: () => void;
      held.set(userId, new Promise<void>((resolve) => { release = resolve; }));
      return release;
    },
    failTablesWith: (error) => { tableError = error; },
  };

  const auth = {
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener);
      // The SDK reports the CURRENT session to a new subscriber asynchronously, after it has finished initialising. It reads the
      // session at the moment of delivery (under the same lock as an in-flight exchange), so a sign-in that happens in between
      // is never overwritten by a stale value. The fake models that.
      queueMicrotask(() => { if (listeners.has(listener)) listener('INITIAL_SESSION', current === undefined ? fake.initialSession : current); });
      return { data: { subscription: { unsubscribe: vi.fn(() => { listeners.delete(listener); }) } } };
    }),
    signUp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signOut: vi.fn(async () => { fake.emit('SIGNED_OUT', null); return { error: null }; }),
    resend: vi.fn(async () => ({ data: {}, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: null, user: null }, error: null })),
  };
  fake.auth = auth;

  function from(table: string) {
    const call: TableCall = { table, operation: 'from', filters: [] };
    tableCalls.push(call);
    const chain = {
      select: () => { call.operation = 'select'; return chain; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return chain; },
      maybeSingle: async (): Promise<QueryResult> => {
        const [, id] = call.filters[0] ?? [];
        if (table === 'profiles' && typeof id === 'string' && held.has(id)) await held.get(id);
        if (tableError) return { data: null, error: tableError };
        const rows = table === 'profiles' ? profiles : settings;
        return { data: typeof id === 'string' ? rows.get(id) ?? null : null, error: null };
      },
      // Anything that would WRITE is recorded so a test can fail on it.
      insert: () => { call.operation = 'insert'; return chain; },
      upsert: () => { call.operation = 'upsert'; return chain; },
      update: () => { call.operation = 'update'; return chain; },
      delete: () => { call.operation = 'delete'; return chain; },
    };
    return chain;
  }

  fake.client = { auth, from } as unknown as AppSupabaseClient;
  return fake;
}

/** Seeds a user with a complete profile and settings, as the sign-up trigger would have. */
export function seedUser(fake: FakeSupabase, id: string, displayName: string): void {
  fake.profiles.set(id, profileRow(id, displayName));
  fake.settings.set(id, settingsRow());
}
