import { useId, type InputHTMLAttributes, type Ref } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled input whose error is announced and tied to it. */
export function Field({ label, error, hint, className = '', ref, ...input }: FieldProps) {
  const id = useId();
  const described = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        {...input}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className="h-11 w-full rounded-[8px] border border-line bg-paper px-3 text-[15px] transition outline-none placeholder:text-ink-2/70 focus:border-copper-deep aria-invalid:border-danger"
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
