import { useState } from 'react';
import { CircleAlert, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SyncPanel } from './SyncPanel';
import { useSync } from './syncContext';

/** A banner only when something needs the student: offline with unsaved work, a paused or failing sync, or changes that were overridden. */
export function SyncBanner() {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  if (!sync.active) return null;
  const { phase, pending, deadLettered, conflicts } = sync.status;

  let text: string | null = null;
  let offline = false;
  if (phase === 'paused') text = 'Saving is paused because your sign-in needs renewing. Your changes are safe on this device.';
  else if (deadLettered > 0) text = 'Some changes could not be saved to your account.';
  else if (phase === 'offline' && pending > 0) { text = `You are offline. ${pending} change${pending === 1 ? ' is' : 's are'} saved on this device and will be sent when you reconnect.`; offline = true; }
  else if (phase === 'attention' && sync.status.message) text = sync.status.message;
  else if (conflicts > 0) text = 'Some of your changes were overridden by newer data from another device.';
  if (!text) return null;

  const Icon = offline ? CloudOff : CircleAlert;
  return (
    <>
      <div role="status" className="mx-auto mb-4 flex w-full max-w-[1240px] items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-ink">
        <Icon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <p className="flex-1">{text}</p>
        <Button size="sm" onClick={() => setOpen(true)}>Review</Button>
        {phase === 'paused' ? null : <Button size="sm" onClick={sync.retry}>Try again</Button>}
      </div>
      <SyncPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
