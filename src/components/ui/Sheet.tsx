import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'center' | 'right';
}

export function Sheet({ open, onClose, title, description, children, footer, side = 'center' }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const isRight = side === 'right';

  return (
    <AnimatePresence>
      {open && (
        <div className={cn('fixed inset-0 z-50 flex', isRight ? 'justify-end' : 'items-end justify-center p-0 sm:items-center sm:p-6')}>
          <motion.div
            className="absolute inset-0 bg-scrim/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative flex max-h-[92vh] w-full flex-col border bg-surface shadow-card',
              isRight
                ? 'h-full max-w-md rounded-none border-l'
                : 'max-w-lg rounded-t-2xl border sm:rounded-2xl',
            )}
            initial={isRight ? { x: '100%' } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={isRight ? { x: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isRight ? { x: '100%' } : { opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
                {description && <p className="mt-0.5 text-[12px] text-ink-2">{description}</p>}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" icon={<X className="size-4" />} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t px-5 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
