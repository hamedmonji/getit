// Widths of the columns in the table of links being added, set by dragging the
// dividers in its header or double-clicking one to fit, as in the list view.

export type BatchColumn = "name" | "size" | "link";

export const BATCH_COLUMNS: BatchColumn[] = ["name", "size", "link"];

export const BATCH_COLUMN_LABELS: Record<BatchColumn, string> = { name: "Name", size: "Size", link: "Link" };

/**
 * Widths in pixels. The name and link columns share the room the size column
 * leaves (null) until a column is resized; then each has its own width.
 */
export interface BatchWidths {
  name: number | null;
  size: number;
  link: number | null;
}

export const DEFAULT_BATCH_WIDTHS: BatchWidths = { name: null, size: 72, link: null };

/** Narrowest each column can be dragged to, and the least a sharing column gets. */
export const MIN_BATCH_WIDTHS: Record<BatchColumn, number> = { name: 120, size: 48, link: 120 };

/** How the name and link columns share the room while neither has a width: as 1 to 1.3. */
const SHARES: Record<"name" | "link", number> = { name: 1, link: 1.3 };

/** Where each column's text is in the table, to measure for fitting it. */
export const BATCH_FIT_SELECTORS: Record<BatchColumn, string> = {
  name: ".link-batch-name",
  size: ".link-batch-size",
  link: ".link-batch-url",
};

/** Room left after the widest text, so a fitted column doesn't cut it off at a rounding. */
const FIT_SLACK = 4;

/** `widths` with `key` set to `width`, kept to the column's minimum, in whole pixels. */
export function resizeBatchColumn(widths: BatchWidths, key: BatchColumn, width: number): BatchWidths {
  return { ...widths, [key]: Math.max(MIN_BATCH_WIDTHS[key], Math.round(width)) };
}

/**
 * `widths` with the sharing columns fixed at `onScreen`, their widths now.
 * Done before resizing any column, so the others keep their widths and the
 * table grows into the empty column at its end instead.
 */
export function pinBatchColumns(widths: BatchWidths, onScreen: { name: number; link: number }): BatchWidths {
  // Rounded down: a fraction more than the room they had would scroll the table sideways.
  const pin = (w: number | null, now: number, min: number) => w ?? Math.max(min, Math.floor(now));
  return {
    ...widths,
    name: pin(widths.name, onScreen.name, MIN_BATCH_WIDTHS.name),
    link: pin(widths.link, onScreen.link, MIN_BATCH_WIDTHS.link),
  };
}

/**
 * `widths` with `key` as wide as the widest of `textWidths` (its header's and
 * its cells' text), within its minimum; unchanged when there's no text.
 */
export function fitBatchColumn(widths: BatchWidths, key: BatchColumn, textWidths: number[]): BatchWidths {
  if (!textWidths.length) return widths;
  return resizeBatchColumn(widths, key, Math.ceil(Math.max(...textWidths)) + FIT_SLACK);
}

/**
 * The table's `grid-template-columns`: the drag handle and tick box, the
 * three columns, and an empty column at the end that takes the slack once the
 * columns all have widths.
 */
export function batchTemplate(w: BatchWidths): string {
  const share = (key: "name" | "link") => {
    const width = w[key];
    return width === null ? `minmax(${MIN_BATCH_WIDTHS[key]}px, ${SHARES[key]}fr)` : `${width}px`;
  };
  const rest = w.name === null || w.link === null ? "0px" : "minmax(0px, 1fr)";
  return ["14px", "16px", share("name"), `${w.size}px`, share("link"), rest].join(" ");
}

/** The gap between the table's columns, and its rows' padding on each side, in pixels, as in its CSS. */
const GAP = 10;
const PADDING = 20;

/**
 * The narrowest the table can be before it scrolls sideways: every column at
 * its width, or its least while sharing, with the gaps and padding.
 */
export function batchTableWidth(w: BatchWidths): number {
  const columns = 14 + 16 + (w.name ?? MIN_BATCH_WIDTHS.name) + w.size + (w.link ?? MIN_BATCH_WIDTHS.link);
  return columns + 5 * GAP + 2 * PADDING;
}

/** Widths saved as JSON; anything missing, too narrow, or not a number falls back to its default. */
export function parseBatchWidths(raw: string | null): BatchWidths {
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // Unreadable; use the defaults.
  }
  const record = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const widths: BatchWidths = { ...DEFAULT_BATCH_WIDTHS };
  for (const key of BATCH_COLUMNS) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= MIN_BATCH_WIDTHS[key]) {
      widths[key] = Math.round(value);
    }
  }
  return widths;
}
