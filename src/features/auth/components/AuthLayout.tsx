import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BRAND } from '@/app/navigation';
import { Card } from '@/components/ui/Card';
import { useThemeSync } from '@/hooks/useThemeSync';

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the "continue in local mode" link on screens where it would be confusing. */
  hideLocalLink?: boolean;
}

/**
 * The frame for every account screen. It uses the app's own card, type and colours, follows the saved theme (it only READS the
 * local theme preference), and always offers the way back to local mode.
 */
export function AuthLayout({ title, description, children, footer, hideLocalLink }: AuthLayoutProps) {
  useThemeSync();
  const Icon = BRAND.icon;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-violet-600 text-white"><Icon className="size-5" aria-hidden /></span>
          <span className="text-[16px] font-semibold text-ink">{BRAND.name}</span>
        </div>
        <Card as="section" className="shadow-card">
          <h1 className="text-[20px] font-semibold text-ink">{title}</h1>
          {description && <p className="mt-1 text-[13px] leading-5 text-ink-2">{description}</p>}
          <div className="mt-5">{children}</div>
        </Card>
        {footer && <div className="mt-4 text-center text-[13px] text-ink-2">{footer}</div>}
        {!hideLocalLink && (
          <div className="mt-6 text-center">
            <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink">
              <ArrowLeft className="size-3.5" aria-hidden /> Continue in local mode
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export const linkClass = 'font-medium text-violet-500 hover:text-violet-400 hover:underline';

/** Shown while the stored session is being restored. Nothing redirects until it finishes. */
export function SessionChecking() {
  return (
    <AuthLayout title="Checking your session…" hideLocalLink>
      <p role="status" className="text-[13px] text-ink-2">One moment.</p>
    </AuthLayout>
  );
}
