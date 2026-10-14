// Icons from the design, drawn on a 16×16 grid.

interface IconProps {
  size?: number;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function BackIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M10 3L5 8l5 5" {...stroke} strokeWidth={1.7} />
    </svg>
  );
}

export function ForwardIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M6 3l5 5-5 5" {...stroke} strokeWidth={1.7} />
    </svg>
  );
}

export function UpIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" {...stroke} strokeWidth={1.7} />
    </svg>
  );
}

export function GridIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="5" height="5" rx="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" />
    </svg>
  );
}

export function ListIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M2 4h12M2 8h12M2 12h12" {...stroke} strokeWidth={1.6} />
    </svg>
  );
}

export function FolderIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"
        {...stroke}
        strokeWidth={1.5}
      />
    </svg>
  );
}

export function PlusIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M8 2v12M2 8h12" {...stroke} strokeWidth={2} />
    </svg>
  );
}

export function ThemeIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ size = 10, weight = 2.2 }: IconProps & { weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M5 3.5v9M11 3.5v9" {...stroke} strokeWidth={weight} />
    </svg>
  );
}

export function PlayIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M5 3v10l8-5z" fill="currentColor" />
    </svg>
  );
}

export function RetryIcon({ size = 11 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" {...stroke} strokeWidth={1.8} />
    </svg>
  );
}

export function SearchIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.5" {...stroke} strokeWidth={1.6} />
      <path d="M10.5 10.5L14 14" {...stroke} strokeWidth={1.6} />
    </svg>
  );
}

export function CloseIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" {...stroke} strokeWidth={2} />
    </svg>
  );
}
