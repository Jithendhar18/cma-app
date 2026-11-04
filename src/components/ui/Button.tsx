import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700 shadow-sm',
  secondary:
    'bg-elevated text-ink border border-line hover:bg-ink/[0.06]',
  ghost: 'text-ink-2 hover:text-ink hover:bg-ink/[0.06]',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-[13px] gap-2 rounded-lg',
  icon: 'size-9 rounded-lg justify-center',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-150 select-none',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
