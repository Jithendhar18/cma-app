import { useState } from 'react';
import { CircleAlert, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { SyncPanel } from './SyncPanel';
import { useSync } from './syncContext';

/** The small always-visible answer to "is my work saved?". Shown only while an account's data is being synced. */
export function SyncChip() {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  if (!sync.active) return null;
  const { phase, pending, deadLettered, conflicts } = sync.status;

  let label = 'Synced';
  let tone = 'text-emerald-600 dark:text-emerald-400';
  let Icon = Cloud;
  if (phase === 'hydrating') { label = 'Loading…'; tone = 'text-ink-3'; Icon = RefreshCw; }
  else if (phase === 'paused' || phase === 'attention' || deadLettered > 0) { label = 'Needs attention'; tone = 'text-amber-600 dark:text-amber-400'; Icon = CircleAlert; }
  else if (phase === 'offline') { label = pending > 0 ? `Offline (${pending} pending)` : 'Offline'; tone = 'text-ink-2'; Icon = CloudOff; }
  else if (phase === 'syncing' || pending > 0) { label = 'Syncing…'; tone = 'text-ink-2'; Icon = RefreshCw; }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Sync status: ${label}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium hover:bg-ink/5 ${tone}`}>
        <Icon className={`size-3.5 ${label === 'Syncing…' || label === 'Loading…' ? 'animate-spin' : ''}`} aria-hidden />
        <span>{label}</span>
        {conflicts > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] text-amber-700 dark:text-amber-300">{conflicts}</span>}
      </button>
      <SyncPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
