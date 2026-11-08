import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { fieldClass, labelClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
}

/** A labelled input wired for assistive technology: the label, the hint and the error are all programmatically linked. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ label, error, hint, className, ...rest }, ref) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(fieldClass, error && 'border-red-500 focus:border-red-500 focus:ring-red-500/30', className)}
        {...rest}
      />
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-ink-3">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  );
});

/** A password input with a show/hide control. The control is a real button, reachable and operable by keyboard. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<TextInputProps, 'type'>>(function PasswordInput({ className, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <TextInput ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute right-1.5 top-[26px] flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:text-ink"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});
