interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Pennydrop mark: a coin halfway through a slot in the target line.
 * Drawn as code so it stays sharp at every size. The coin drops in on mount.
 */
export function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Pennydrop"
    >
      <path d="M3 24h11M34 24h11" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <g className="mark-coin">
        <circle cx="24" cy="24" r="9" fill="var(--copper)" />
        <circle
          cx="24"
          cy="24"
          r="6"
          fill="none"
          stroke="var(--on-copper)"
          strokeOpacity="0.35"
          strokeWidth="1.4"
        />
      </g>
    </svg>
  );
}
