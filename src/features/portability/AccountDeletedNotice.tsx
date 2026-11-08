import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { Notice } from '@/features/auth/components/Notice';

/** Set (in this tab's session storage only) once the server has confirmed a deletion, so the screen the student lands on can say so. */
export const DELETED_NOTICE_KEY = 'cma-account-deleted';

export function AccountDeletedNotice() {
  const [shown, setShown] = useState(false);
  const { pathname } = useLocation();
  // The notice is set just before the sign-out moves the student to another screen, so it is read again whenever the screen changes.
  useEffect(() => {
    try { if (sessionStorage.getItem(DELETED_NOTICE_KEY) === '1') setShown(true); } catch { /* nothing to show */ }
  }, [pathname]);
  if (!shown) return null;
  const dismiss = () => {
    try { sessionStorage.removeItem(DELETED_NOTICE_KEY); } catch { /* ignore */ }
    setShown(false);
  };
  return (
    <div className="mx-auto mb-4 flex w-full max-w-[1240px] items-start gap-2">
      <Notice tone="success" className="flex-1"><p className="font-medium">Your account was deleted.</p><p>You have been signed out. The study data on this device was not changed.</p></Notice>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="mt-2 text-ink-3 hover:text-ink"><X className="size-4" /></button>
    </div>
  );
}
