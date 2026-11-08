import { describe, expect, it } from 'vitest';
import { createFakeSupabase, profileRow, seedUser, settingsRow } from '@/test/fakeSupabase';
import { loadAccount, parseProfile, parseSettings } from './accountApi';

const ID = '11111111-1111-4111-8111-111111111111';

describe('loadAccount', () => {
  it('loads the profile and settings of the signed-in user', async () => {
    const fake = createFakeSupabase();
    seedUser(fake, ID, 'Asha');
    const result = await loadAccount(fake.client, ID);
    expect(result).toMatchObject({ kind: 'ready', profile: { id: ID, displayName: 'Asha', timeZone: 'Asia/Kolkata', onboardingCompletedAt: null }, settings: { dailyTargetHours: 8, theme: 'dark' } });
  });

  it('only reads, and only the two account tables, filtered to the user', async () => {
    const fake = createFakeSupabase();
    seedUser(fake, ID, 'Asha');
    await loadAccount(fake.client, ID);
    expect(fake.tableCalls.map((c) => c.operation)).toEqual(['select', 'select']);
    expect(fake.tableCalls.map((c) => c.table).sort()).toEqual(['profiles', 'user_settings']);
    expect(fake.tableCalls.find((c) => c.table === 'profiles')?.filters).toEqual([['id', ID]]);
    expect(fake.tableCalls.find((c) => c.table === 'user_settings')?.filters).toEqual([['user_id', ID]]);
  });

  it('never creates a missing profile: it reports it as an explicit, recoverable state', async () => {
    const fake = createFakeSupabase();
    fake.settings.set(ID, settingsRow());
    expect(await loadAccount(fake.client, ID)).toEqual({ kind: 'incomplete', missing: 'profile' });
    expect(fake.tableCalls.every((c) => c.operation === 'select')).toBe(true);
  });

  it('reports missing settings separately', async () => {
    const fake = createFakeSupabase();
    fake.profiles.set(ID, profileRow(ID, 'Asha'));
    expect(await loadAccount(fake.client, ID)).toEqual({ kind: 'incomplete', missing: 'settings' });
  });

  it('turns a server or network error into a classified failure, not a throw', async () => {
    const fake = createFakeSupabase();
    seedUser(fake, ID, 'Asha');
    fake.failTablesWith({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' });
    expect(await loadAccount(fake.client, ID)).toEqual({ kind: 'error', failure: 'network' });
    fake.failTablesWith({ code: '42501', message: 'permission denied for table profiles' });
    expect(await loadAccount(fake.client, ID)).toEqual({ kind: 'error', failure: 'unknown' });
  });

  it('treats a row it cannot understand as an error, never a silent default', async () => {
    const fake = createFakeSupabase();
    fake.profiles.set(ID, { ...profileRow(ID, 'Asha'), display_name: 42 });
    fake.settings.set(ID, settingsRow());
    expect(await loadAccount(fake.client, ID)).toEqual({ kind: 'error', failure: 'unexpected-data' });
  });

  it('refuses a profile whose id is not the one asked for', async () => {
    const fake = createFakeSupabase();
    fake.profiles.set(ID, profileRow('22222222-2222-4222-8222-222222222222', 'Someone else'));
    fake.settings.set(ID, settingsRow());
    expect(await loadAccount(fake.client, ID)).toEqual({ kind: 'error', failure: 'unexpected-data' });
  });

  it('keeps hostile display-name text as plain text (it is only ever rendered by React)', async () => {
    const fake = createFakeSupabase();
    seedUser(fake, ID, '<img src=x onerror=alert(1)>');
    const result = await loadAccount(fake.client, ID);
    expect(result.kind === 'ready' && result.profile.displayName).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('row parsing', () => {
  it('accepts numeric strings for numeric columns and rejects junk', () => {
    expect(parseSettings({ ...settingsRow(), daily_target_hours: '7.5' })?.dailyTargetHours).toBe(7.5);
    for (const bad of [{ ...settingsRow(), daily_target_hours: 'abc' }, { ...settingsRow(), theme: 'purple' }, { ...settingsRow(), study_start_time: 600 }, null, 'x', 7]) expect(parseSettings(bad)).toBeNull();
  });
  it('requires a string id, name and time zone', () => {
    expect(parseProfile(profileRow(ID, 'A'))).not.toBeNull();
    for (const bad of [{ ...profileRow(ID, 'A'), id: 1 }, { ...profileRow(ID, 'A'), time_zone: null }, { ...profileRow(ID, 'A'), onboarding_completed_at: 5 }, null, []]) expect(parseProfile(bad)).toBeNull();
  });
});
