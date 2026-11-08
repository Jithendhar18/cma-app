import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '@/App';

/** An obviously fake anonymous-role JWT. Not a credential: the signature is a placeholder. */
export function fakeAnonKey(): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64({ role: 'anon', iss: 'placeholder' })}.placeholder-signature`;
}

/** Switches accounts on for the test, with a placeholder project. Pair with vi.unstubAllEnvs() in afterEach. */
export function enableAccounts(): void {
  vi.stubEnv('VITE_SUPABASE_AUTH_ENABLED', 'true');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://placeholder-project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', fakeAnonKey());
}

export function disableAccounts(): void {
  vi.stubEnv('VITE_SUPABASE_AUTH_ENABLED', 'false');
}

/** Renders the real <App /> at an address (it owns a BrowserRouter, so the address is set through the history API). */
export function startApp(path: string) {
  window.history.pushState(null, '', path);
  return { user: userEvent.setup(), ...render(<App />) };
}
