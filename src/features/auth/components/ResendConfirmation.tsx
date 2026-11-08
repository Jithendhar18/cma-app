import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '../authContext';
import { resendConfirmation } from '../authService';
import { Notice } from './Notice';

const COOLDOWN_SECONDS = 60;

/** Sends the confirmation email again, with a short cooldown so the button cannot be hammered. */
export function ResendConfirmation({ email }: { email: string }) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function onResend() {
    if (!client) return;
    setBusy(true);
    setMessage(null);
    const result = await resendConfirmation(client, email);
    setBusy(false);
    if (result.kind === 'sent') {
      setMessage({ tone: 'success', text: 'If that address can be confirmed, a new email is on its way.' });
      setCooldown(COOLDOWN_SECONDS);
    } else {
      setMessage({ tone: 'error', text: result.message });
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={onResend} disabled={busy || cooldown > 0 || !client} icon={<Mail className="size-4" aria-hidden />}>
        {busy ? 'Sending…' : cooldown > 0 ? `Send again in ${cooldown}s` : 'Send the email again'}
      </Button>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
