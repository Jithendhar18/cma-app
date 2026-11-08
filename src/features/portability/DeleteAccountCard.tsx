import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { useAuth } from '@/features/auth/authContext';
import { Notice } from '@/features/auth/components/Notice';
import { PasswordInput, TextInput } from '@/features/auth/components/TextInput';
import { clearAccountKeys } from '@/lib/account/keys';
import { DELETED_NOTICE_KEY } from './AccountDeletedNotice';
import { DELETE_PHRASE, deleteAccount } from '@/lib/portability/deleteAccount';
import { downloadJson, exportAccountData, exportFileName, serializeExport } from '@/lib/portability/accountExport';

/**
 * Permanent deletion. Never a single click: it needs the confirmation phrase AND the password, then asks the server, and only the server's
 * "deleted" ends the account here. Anything else (wrong password, expired sign-in, network, refusal) leaves the account exactly as it was.
 */
export function DeleteAccountCard() {
  const { client, state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const phraseRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) phraseRef.current?.focus(); }, [open]);
  if (state.status !== 'signed-in') return null;
  const { user } = state;
  const email = user.email ?? '';
  const ready = phrase.trim() === DELETE_PHRASE && password.length > 0 && email !== '' && !busy;

  function close() {
    if (busy) return;
    setOpen(false);
    setPhrase('');
    setPassword('');
    setError(null);
    setNote(null);
  }

  async function exportFirst() {
    if (!client) return;
    setNote(null);
    try {
      const doc = await exportAccountData(client, user.id);
      downloadJson(exportFileName(doc), serializeExport(doc));
      setNote('Your data was downloaded.');
    } catch {
      setNote('Could not download your data. Nothing was deleted.');
    }
  }

  async function confirmDelete() {
    if (!client || !ready) return;
    setBusy(true);
    setError(null);
    const result = await deleteAccount(client, { email, password, phrase });
    if (result.kind === 'failed') {
      setError(result.message);
      setPassword('');
      setBusy(false);
      return;
    }
    // The server has confirmed. Only now does this browser forget the account: sign out (the app returns to local mode), then clear that
    // account's own keys (never the local-mode keys). The confirmation is shown on the screen the student lands on.
    try { sessionStorage.setItem(DELETED_NOTICE_KEY, '1'); } catch { /* the sign-out still happens */ }
    await signOut();
    clearAccountKeys(user.id);
    setTimeout(() => clearAccountKeys(user.id), 0); // anything that was mid-write while the stores unbound
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader title="Delete your account" description="Permanently removes your account and all the study data saved in it." />
      <p className="mb-3 text-[13px] text-ink-2">This cannot be undone. The data on this device from before you signed in is not touched.</p>
      <Button variant="danger" onClick={() => setOpen(true)} icon={<Trash2 className="size-4" aria-hidden />}>Delete my account…</Button>

      <Sheet open={open} onClose={close} title="Delete your account?" description="This is permanent and cannot be undone."
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="danger" onClick={() => void confirmDelete()} disabled={!ready}>{busy ? 'Deleting…' : 'Delete my account permanently'}</Button></>}>
        <div className="space-y-4 text-[13px] text-ink-2">
          <ul className="list-disc space-y-1 pl-5">
            <li>Your profile, settings, enrolments and every study record in your account will be deleted for good.</li>
            <li>We cannot recover them afterwards.</li>
            <li>Nothing on this device is removed.</li>
          </ul>
          <div><Button size="sm" onClick={() => void exportFirst()}>Download my data first (recommended)</Button>{note && <p role="status" className="mt-2 text-[12px] text-ink-3">{note}</p>}</div>
          <TextInput ref={phraseRef} label={`Type ${DELETE_PHRASE} to confirm`} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
          <PasswordInput label="Your password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="Asked again for your safety. It is checked by the server and never stored here." />
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>
    </Card>
  );
}
