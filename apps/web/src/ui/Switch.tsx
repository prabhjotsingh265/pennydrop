/** An on/off control, announced as a switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  busy = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-copper bg-copper' : 'border-ink-2/60 bg-surface'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-4 rounded-full shadow-sm transition duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${
          checked ? 'translate-x-[19px] bg-paper' : 'translate-x-[3px] bg-ink-2'
        } ${busy ? 'animate-pulse' : ''}`}
      />
    </button>
  );
}
