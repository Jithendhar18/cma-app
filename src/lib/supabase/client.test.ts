import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from './config';

const createClient = vi.hoisted(() => vi.fn(() => ({ marker: 'client' })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { AUTH_STORAGE_KEY, getSupabaseClient, resetSupabaseClientForTests } from './client';

const enabled: AuthConfig = { status: 'enabled', url: 'https://placeholder-project.supabase.co', anonKey: 'placeholder-public-key' };

beforeEach(() => {
  resetSupabaseClientForTests();
  createClient.mockClear();
});
afterEach(() => resetSupabaseClientForTests());

describe('getSupabaseClient', () => {
  it('returns null and never loads the SDK when accounts are disabled', async () => {
    expect(await getSupabaseClient({ status: 'disabled' })).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns null and never creates a client when the configuration is bad', async () => {
    expect(await getSupabaseClient({ status: 'misconfigured', problem: 'missing-key' })).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates one client with the validated URL and key, using PKCE and the SDK session handling', async () => {
    await getSupabaseClient(enabled);
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }];
    expect(url).toBe(enabled.status === 'enabled' ? enabled.url : '');
    expect(key).toBe('placeholder-public-key');
    expect(options.auth).toMatchObject({ flowType: 'pkce', persistSession: true, autoRefreshToken: true });
  });

  it('stores its session under its own key, distinct from every local-mode store key', async () => {
    await getSupabaseClient(enabled);
    const [, , options] = createClient.mock.calls[0] as unknown as [string, string, { auth: { storageKey: string } }];
    expect(options.auth.storageKey).toBe(AUTH_STORAGE_KEY);
    for (const localKey of ['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui']) expect(AUTH_STORAGE_KEY).not.toBe(localKey);
  });

  it('leaves the address bar to the callback pages (the SDK is told not to read it)', async () => {
    await getSupabaseClient(enabled);
    const [, , options] = createClient.mock.calls[0] as unknown as [string, string, { auth: { detectSessionInUrl: boolean } }];
    expect(options.auth.detectSessionInUrl).toBe(false);
  });

  it('returns the same client on every call', async () => {
    const [a, b] = await Promise.all([getSupabaseClient(enabled), getSupabaseClient(enabled)]);
    expect(a).toBe(b);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
