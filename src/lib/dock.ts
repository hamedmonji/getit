import type { DownloadId, DownloadItem } from "./engine";
import { formatSpeed } from "./format";

/** What the Dock icon shows for the downloads running now. */
export interface DockStatus {
  /** Overall progress from 0 to 100, or null when no running download knows its size. */
  progress: number | null;
  /** Combined speed for the Dock badge, or null while nothing is moving yet. */
  label: string | null;
}

/**
 * The Dock's progress and speed across all running downloads, or null when
 * nothing is downloading. Progress counts only downloads whose size is known.
 */
export function dockStatus(
  downloads: Record<DownloadId, DownloadItem>,
  speeds: Record<DownloadId, number>,
): DockStatus | null {
  let running = 0;
  let downloaded = 0;
  let total = 0;
  let speed = 0;
  for (const item of Object.values(downloads)) {
    if (item.status !== "downloading") continue;
    running++;
    speed += speeds[item.id] ?? 0;
    if (item.total_bytes != null && item.total_bytes > 0) {
      total += item.total_bytes;
      downloaded += Math.min(item.downloaded, item.total_bytes);
    }
  }
  if (running === 0) return null;
  return {
    progress: total > 0 ? Math.floor((downloaded / total) * 100) : null,
    label: speed > 0 ? formatSpeed(speed) : null,
  };
}

/** Whether the Dock already shows `b` when it shows `a`. */
export function sameDockStatus(a: DockStatus | null, b: DockStatus | null): boolean {
  if (a === null || b === null) return a === b;
  return a.progress === b.progress && a.label === b.label;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the overlay's parts go on the Dock icon, as fractions of its side, from the top left. */
export interface DockOverlayLayout {
  /** The rounded dark panel behind the speed and the bar. */
  panel: Rect;
  /** The speed, centered on `x`, `y`, at most `maxWidth` wide. */
  text: { value: string; x: number; y: number; size: number; maxWidth: number } | null;
  /** The progress bar's track and its filled part. */
  bar: { track: Rect; fill: Rect } | null;
}

/** The panel spans nearly the whole icon, a little past its body, so it reads at Dock size. */
const LEFT = 0.04;
const WIDTH = 0.92;
const BOTTOM = 0.96;
const PAD = 0.04;
const TEXT_SIZE = 0.22;
const TEXT_ROW = 0.24;
const BAR = 0.08;

/** Lays out the speed above the progress bar at the bottom of the icon; null when neither is known. */
export function dockOverlayLayout(status: DockStatus | null): DockOverlayLayout | null {
  if (status === null || (status.label === null && status.progress === null)) return null;
  const rows = (status.label === null ? 0 : TEXT_ROW) + (status.progress === null ? 0 : BAR);
  const gap = status.label !== null && status.progress !== null ? PAD / 2 : 0;
  const height = rows + gap + 2 * PAD;
  const top = BOTTOM - height;
  const inner = WIDTH - 2 * PAD;
  const text =
    status.label === null
      ? null
      : { value: status.label, x: LEFT + WIDTH / 2, y: top + PAD + TEXT_ROW / 2, size: TEXT_SIZE, maxWidth: inner };
  let bar: DockOverlayLayout["bar"] = null;
  if (status.progress !== null) {
    const track = { x: LEFT + PAD, y: BOTTOM - PAD - BAR, width: inner, height: BAR };
    bar = { track, fill: { ...track, width: (inner * Math.min(100, Math.max(0, status.progress))) / 100 } };
  }
  return { panel: { x: LEFT, y: top, width: WIDTH, height }, text, bar };
}
