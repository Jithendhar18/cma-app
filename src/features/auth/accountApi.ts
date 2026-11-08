import type { AppSupabaseClient } from '@/lib/supabase/client';
import { classifyAuthError, type AuthFailure } from './errors';

/**
 * Loads the signed-in user's profile and settings. READ ONLY: the database trigger created both rows when the account was
 * registered, so this never inserts. Row level security already limits both tables to the owner; the explicit filters are a
 * second, visible statement of intent and keep the query cheap.
 *
 * Everything that comes back is untrusted text (a display name is whatever the user typed at sign-up). It is rendered by React,
 * which escapes it, and is never placed in markup, a URL or a script.
 */

export interface Profile {
  id: string;
  displayName: string;
  timeZone: string;
  onboardingCompletedAt: string | null;
}

export interface AccountSettings {
  dailyTargetHours: number;
  weeklyTargetHours: number;
  studyStartTime: string;
  studyEndTime: string;
  pomodoroFocusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  theme: 'dark' | 'light' | 'system';
}

export type AccountLoad =
  | { kind: 'ready'; profile: Profile; settings: AccountSettings }
  | { kind: 'incomplete'; missing: 'profile' | 'settings' }
  | { kind: 'error'; failure: AuthFailure };

const PROFILE_COLUMNS = 'id, display_name, time_zone, onboarding_completed_at';
const SETTINGS_COLUMNS =
  'daily_target_hours, weekly_target_hours, study_start_time, study_end_time, pomodoro_focus_minutes, short_break_minutes, long_break_minutes, long_break_every, theme';

const isString = (v: unknown): v is string => typeof v === 'string';
// PostgREST returns numeric columns as numbers, but be tolerant of a numeric string and strict about anything else.
const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function parseProfile(row: unknown): Profile | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  if (!isString(r.id) || !isString(r.display_name) || !isString(r.time_zone)) return null;
  if (r.onboarding_completed_at !== null && !isString(r.onboarding_completed_at)) return null;
  return { id: r.id, displayName: r.display_name, timeZone: r.time_zone, onboardingCompletedAt: r.onboarding_completed_at };
}

export function parseSettings(row: unknown): AccountSettings | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const daily = asNumber(r.daily_target_hours);
  const weekly = asNumber(r.weekly_target_hours);
  const focus = asNumber(r.pomodoro_focus_minutes);
  const shortBreak = asNumber(r.short_break_minutes);
  const longBreak = asNumber(r.long_break_minutes);
  const every = asNumber(r.long_break_every);
  if (daily === null || weekly === null || focus === null || shortBreak === null || longBreak === null || every === null) return null;
  if (!isString(r.study_start_time) || !isString(r.study_end_time)) return null;
  if (r.theme !== 'dark' && r.theme !== 'light' && r.theme !== 'system') return null;
  return {
    dailyTargetHours: daily,
    weeklyTargetHours: weekly,
    studyStartTime: r.study_start_time,
    studyEndTime: r.study_end_time,
    pomodoroFocusMinutes: focus,
    shortBreakMinutes: shortBreak,
    longBreakMinutes: longBreak,
    longBreakEvery: every,
    theme: r.theme,
  };
}

export async function loadAccount(client: AppSupabaseClient, userId: string): Promise<AccountLoad> {
  try {
    const [profileResult, settingsResult] = await Promise.all([
      client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
      client.from('user_settings').select(SETTINGS_COLUMNS).eq('user_id', userId).maybeSingle(),
    ]);
    if (profileResult.error) return { kind: 'error', failure: classifyAuthError(profileResult.error) };
    if (settingsResult.error) return { kind: 'error', failure: classifyAuthError(settingsResult.error) };
    if (profileResult.data === null) return { kind: 'incomplete', missing: 'profile' };
    if (settingsResult.data === null) return { kind: 'incomplete', missing: 'settings' };
    const profile = parseProfile(profileResult.data);
    const settings = parseSettings(settingsResult.data);
    // A row we cannot make sense of is an error, never a silent default.
    if (!profile || !settings || profile.id !== userId) return { kind: 'error', failure: 'unexpected-data' };
    return { kind: 'ready', profile, settings };
  } catch (error) {
    return { kind: 'error', failure: classifyAuthError(error) };
  }
}
