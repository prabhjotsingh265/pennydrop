import type { ButtonHTMLAttributes } from 'react';

export type Variant = 'primary' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-copper text-on-copper hover:brightness-[1.04] active:brightness-95',
  quiet: 'border border-line bg-surface text-ink hover:border-ink-2/40',
  danger: 'border border-danger/40 bg-surface text-danger hover:border-danger',
};

/** The classes of a button, for links that look like one. */
export function buttonClass(variant: Variant = 'quiet', extra = '') {
  return `inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-4 text-sm font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${extra}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows that the action is under way, and stops it being pressed twice. */
  busy?: boolean;
}

export function Button({
  variant = 'quiet',
  busy = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass(variant, className)}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
}
