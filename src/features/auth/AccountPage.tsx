import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, HardDrive, LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from './authContext';
import { useAccountMode } from '@/features/account/accountContext';
import { useSync } from '@/features/sync/syncContext';
import { failureMessage } from './errors';
import { Notice } from './components/Notice';

/**
 * The signed-in account screen. It says plainly which data is in use: while an account's own study data is on screen it is saved to the
 * account; otherwise (local data, or the account is not set up yet) nothing is uploaded, and a signed-in person is never led to believe
 * their local progress is being saved to the cloud.
 * (This page is only reachable through <RequireAuth>, so a signed-out visitor never sees it.)
 */
export default function AccountPage() {
  const { state, signOut, reloadAccount } = useAuth();
  const mode = useAccountMode();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const sync = useSync();
  const [unsaved, setUnsaved] = useState<number | null>(null);

  if (state.status !== 'signed-in') return null;

  async function onSignOut(force = false) {
    setSigningOut(true);
    setSignOutError(null);
    // Changes still waiting to be saved are sent first. If they cannot be, ask before leaving: they stay on this device and resume next time.
    if (!force && sync.active) {
      const flushed = await sync.flushAll();
      if (!flushed.ok) {
        setUnsaved(flushed.pending);
        setSigningOut(false);
        return;
      }
    }
    setUnsaved(null);
    const result = await signOut();
    setSigningOut(false);
    // On success the session change moves the app out of this screen on its own.
    if (result.kind === 'failed') setSignOutError(result.message);
  }

  const { account, user } = state;

  return (
    <div className="space-y-6">
      <PageHeader title="Account" subtitle="Your sign-in and profile. Your study data has not moved." />

      {sync.active ? (
        <Notice tone="info">
          <p className="font-medium">Your study progress is saved to your account.</p>
          <p className="mt-1">Changes are kept on this device first and sent to your account as soon as there is a connection. The data on this device from before you signed in is separate and is never uploaded or merged.</p>
        </Notice>
      ) : (
        <Notice tone="info">
          <p className="font-medium">Signing in does not sync your progress yet.</p>
          <p className="mt-1">The study progress, timer and settings you already have are stored only on this device, exactly as before, and are never uploaded. Only the study data of your account is saved to your account.</p>
        </Notice>
      )}

      {mode.available && (
        <Card>
          <CardHeader title="Which study data to use" description="Your account data and the data on this device are kept completely separate. Signing in never copies one into the other." />
          <div role="radiogroup" aria-label="Study data" className="grid gap-3 sm:grid-cols-2">
            {([
              { value: 'account', title: 'My account', text: 'Your enrolment, official curriculum and the progress saved to your account.' },
              { value: 'local', title: 'This device only', text: 'The study data already on this device, with the sample curriculum, exactly as before.' },
            ] as const).map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={mode.preference === o.value} onClick={() => mode.setPreference(o.value)}
                className={`rounded-lg border p-3 text-left text-[13px] transition-colors ${mode.preference === o.value ? 'border-violet-500 bg-violet-500/10' : 'hover:border-violet-500/40'}`}>
                <span className="block font-medium text-ink">{o.title}</span>
                <span className="mt-0.5 block text-[12px] text-ink-3">{o.text}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

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
            <li className="flex gap-2.5"><CloudOff className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />{sync.active ? 'Your account data is also kept on this device so the app works offline. Signing out does not delete it.' : 'Choose "My account" above to study with your enrolment and save your progress to your account.'}</li>
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={() => void onSignOut()} disabled={signingOut} icon={<LogOut className="size-4" aria-hidden />}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
            <Link to="/" className="text-[13px] font-medium text-violet-500 hover:underline">Back to the app</Link>
          </div>
          {unsaved !== null && (
            <Notice tone="error" className="mt-4">
              <p className="font-medium">{unsaved} change{unsaved === 1 ? ' has' : 's have'} not been saved to your account yet.</p>
              <p className="mt-1">They stay on this device and will be sent the next time you sign in. Or stay signed in and try again once you are online.</p>
              <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => setUnsaved(null)}>Stay signed in</Button><Button size="sm" variant="danger" onClick={() => void onSignOut(true)}>Sign out anyway</Button></div>
            </Notice>
          )}
          {signOutError && <Notice tone="error" className="mt-4">{signOutError}</Notice>}
        </Card>
      </div>
    </div>
  );
}
