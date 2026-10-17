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

/** A funnel, for filtering search results. */
export function FilterIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M2.5 3.5h11L9.2 8.6v3.9L6.8 13.7V8.6z" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}

/** A chevron pointing up, or down when `open`, for showing and hiding the details panel. */
export function ExpandIcon({ size = 12, open = false }: IconProps & { open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d={open ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"} {...stroke} strokeWidth={1.7} />
    </svg>
  );
}

/** A window with a panel on its right, for the overview. */
export function OverviewIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="10" rx="2" {...stroke} strokeWidth={1.5} />
      <path d="M10 3v10" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}

/** A gear, for settings. */
export function GearIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="2.2" {...stroke} strokeWidth={1.5} />
      <path
        d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6"
        {...stroke}
        strokeWidth={1.5}
      />
      <circle cx="8" cy="8" r="4.6" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}

/** Three lines, for a row that can be dragged. */
export function GripIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path d="M3 5h10M3 8h10M3 11h10" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}
