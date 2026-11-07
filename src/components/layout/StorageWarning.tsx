import { useEffect, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { STORAGE_ERROR_EVENT } from '@/lib/safeStorage';

/** Shown only if the browser refuses to save (storage full or blocked), so data loss is never silent. */
export function StorageWarning() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(STORAGE_ERROR_EVENT, show);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, show);
  }, []);
  if (!visible) return null;
  return (
    <div role="alert" className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-amber-500/40 bg-surface p-3 text-[13px] text-ink shadow-card">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <p className="flex-1">Your browser could not save recent changes (storage may be full or blocked). Export your data from Settings to keep a copy.</p>
      <button type="button" aria-label="Dismiss" onClick={() => setVisible(false)} className="text-ink-3 hover:text-ink"><X className="size-4" /></button>
    </div>
  );
}
