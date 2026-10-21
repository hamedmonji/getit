// Widths of the list view's columns, set by dragging the dividers in its header.

export type ColumnKey = "name" | "progress" | "size" | "status";

export const COLUMNS: ColumnKey[] = ["name", "status", "progress", "size"];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Name",
  progress: "Progress",
  size: "Size",
  status: "Status",
};

/** Widths in pixels. The name column fills what the others leave until a column is resized. */
export interface ColumnWidths {
  name: number | null;
  progress: number;
  size: number;
  status: number;
}

export const DEFAULT_WIDTHS: ColumnWidths = { name: null, progress: 120, size: 80, status: 200 };

/** Narrowest each column can be dragged to; the name column's is also its least when filling. */
export const MIN_WIDTHS: Record<ColumnKey, number> = { name: 120, progress: 60, size: 56, status: 80 };


/** `widths` with `key` set to `width`, kept to the column's minimum, in whole pixels. */
export function resizeColumn(widths: ColumnWidths, key: ColumnKey, width: number): ColumnWidths {
  return { ...widths, [key]: Math.max(MIN_WIDTHS[key], Math.round(width)) };
}

/**
 * `widths` with a filling name column fixed at `width`, its current width on screen.
 * Done before resizing any column, so the column grows to the right, into the
 * empty column at the end, rather than taking its room from the name column on the left.
 */
export function pinName(widths: ColumnWidths, width: number): ColumnWidths {
  if (widths.name !== null) return widths;
  // Rounded down: a fraction more than the room it had would scroll the list sideways.
  return { ...widths, name: Math.max(MIN_WIDTHS.name, Math.floor(width)) };
}

/** `widths` with `key` back to its default. */
export function resetColumn(widths: ColumnWidths, key: ColumnKey): ColumnWidths {
  return { ...widths, [key]: DEFAULT_WIDTHS[key] };
}

/**
 * The columns' `grid-template-columns`, without the action button and icon in
 * front of each row. Once the name column is sized, an empty column at the end
 * takes up the slack instead, so the columns keep their widths.
 */
export function columnTemplate(w: ColumnWidths): string {
  const name = w.name === null ? `minmax(${MIN_WIDTHS.name}px, 1fr)` : `${w.name}px`;
  const rest = w.name === null ? "0px" : "minmax(0px, 1fr)";
  return [...COLUMNS.map((key) => (key === "name" ? name : `${w[key]}px`)), rest].join(" ");
}

/** Total width the columns need, so the list scrolls sideways rather than squeezing them. */
export function columnsWidth(w: ColumnWidths): number {
  return (w.name ?? MIN_WIDTHS.name) + w.progress + w.size + w.status;
}

/** Widths saved as JSON; anything missing, too narrow, or not a number falls back to its default. */
export function parseColumnWidths(raw: string | null): ColumnWidths {
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // Unreadable; use the defaults.
  }
  const record = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const widths = { ...DEFAULT_WIDTHS };
  for (const key of COLUMNS) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= MIN_WIDTHS[key]) {
      widths[key] = Math.round(value);
    }
  }
  return widths;
}
