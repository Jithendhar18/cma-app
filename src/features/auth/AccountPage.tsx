import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, HardDrive, LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from './authContext';
import { failureMessage } from './errors';
import { Notice } from './components/Notice';

/**
 * The signed-in account screen. It shows what the account holds and, plainly, what it does NOT do yet: study progress is not
 * synchronised, so a signed-in person is never led to believe their local progress is being saved to the cloud.
 * (This page is only reachable through <RequireAuth>, so a signed-out visitor never sees it.)
 */
export default function AccountPage() {
  const { state, signOut, reloadAccount } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  if (state.status !== 'signed-in') return null;

  async function onSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    const result = await signOut();
    setSigningOut(false);
    // On success the session change moves the app out of this screen on its own.
    if (result.kind === 'failed') setSignOutError(result.message);
  }

  const { account, user } = state;

  return (
    <div className="space-y-6">
      <PageHeader title="Account" subtitle="Your sign-in and profile. Your study data has not moved." />

      <Notice tone="info">
        <p className="font-medium">Signing in does not sync your progress yet.</p>
        <p className="mt-1">Your study progress, timer and settings are still stored only on this device, exactly as before. Syncing them to your account arrives in a later update, and nothing is uploaded unless you choose it then.</p>
      </Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" description="Read from your account." />
          {account.phase === 'loading' && <p role="status" className="text-[13px] text-ink-2">Loading your profile…</p>}
          {account.phase === 'ready' && (
            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className="text-ink-3">Display name</dt>
                {/* user-controlled text: rendered as plain text by React, never as markup */}
                <dd className="mt-0.5 flex items-center gap-2 break-words font-medium text-ink"><UserRound className="size-4 text-ink-3" aria-hidden />{account.profile.displayName}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Email</dt>
                <dd className="mt-0.5 break-all text-ink">{user.email ?? 'Not available'}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Time zone</dt>
                <dd className="mt-0.5 text-ink">{account.profile.timeZone}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Account settings</dt>
                <dd className="mt-0.5 text-ink">
                  {account.settings.dailyTargetHours} h daily target, {account.settings.weeklyTargetHours} h weekly, {account.settings.pomodoroFocusMinutes}-minute focus blocks
                </dd>
                <dd className="mt-1 text-[12px] text-ink-3">These are your account's saved defaults. They are separate from the settings used in local mode.</dd>
              </div>
            </dl>
          )}
          {account.phase === 'incomplete' && (
            <div className="space-y-3">
              <Notice tone="error">
                {account.missing === 'profile' ? 'Your account profile is not ready yet.' : 'Your account settings are not ready yet.'} This is usually temporary.
              </Notice>
              <Button onClick={reloadAccount}>Try again</Button>
            </div>
          )}
          {account.phase === 'error' && (
            <div className="space-y-3">
              <Notice tone="error">{failureMessage(account.failure)}</Notice>
              <Button onClick={reloadAccount}>Try again</Button>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="This device" description="What stays where." />
          <ul className="space-y-3 text-[13px] text-ink-2">
            <li className="flex gap-2.5"><HardDrive className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />Your study progress is stored in this browser. Signing out does not delete it.</li>
            <li className="flex gap-2.5"><CloudOff className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />Cloud sync, course selection and onboarding are coming in later updates.</li>
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={onSignOut} disabled={signingOut} icon={<LogOut className="size-4" aria-hidden />}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
            <Link to="/" className="text-[13px] font-medium text-violet-500 hover:underline">Back to the app</Link>
          </div>
          {signOutError && <Notice tone="error" className="mt-4">{signOutError}</Notice>}
        </Card>
      </div>
    </div>
  );
}
