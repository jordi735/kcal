type IconProps = { size?: number };

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...BASE}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...BASE}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...BASE}>
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...BASE}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}
