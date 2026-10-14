// Turns engine state into what the views display. Ported from the design's
// `fileVm` / `folderStats` logic, using real engine data instead of a simulation.

import type { EngineState } from "../hooks/useEngine";
import type { DownloadItem, QueueInfo } from "./engine";
import { formatEta, formatSize, formatSpeed } from "./format";
import { isWithin, joinPath } from "./paths";

export type ViewMode = "Icons" | "List";
export type FileAction = "pause" | "resume" | "retry";

const MEDIA = ["JPG", "JPEG", "PNG", "GIF", "TIF", "TIFF", "WEBP", "HEIC", "MP4", "MKV", "MOV", "WEBM"];

export interface FileVm {
  id: string;
  name: string;
  ext: string;
  status: string;
  sizeLabel: string;
  /** 0–100. */
  pct: number;
  /** Progress colour: accent while running, danger when failed, muted otherwise. */
  color: string;
  nameColor: string;
  isMedia: boolean;
  done: boolean;
  missing: boolean;
  hue: number;
  showBar: boolean;
  action: FileAction | null;
  actionLabel: string;
  info: string;
  /** Final path, once known. */
  path: string | null;
}

export interface FolderVm {
  name: string;
  path: string;
  sub: string;
  sizeLabel: string;
  active: number;
  paused: boolean;
  showBar: boolean;
  pct: number;
  barColor: string;
  tint: string;
  /** Whether a queue downloads into this folder or one inside it. */
  hasQueue: boolean;
}

export interface Stats {
  total: number;
  pct: number;
  active: number;
  queued: number;
  done: number;
  speed: number;
  pending: number;
}

export function displayName(item: DownloadItem): string {
  if (item.file_name) return item.file_name;
  try {
    const url = new URL(item.url);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url.hostname;
  } catch {
    return item.url;
  }
}

function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function percent(item: DownloadItem): number {
  if (item.status === "completed") return 100;
  if (!item.total_bytes) return 0;
  return Math.min(100, (item.downloaded / item.total_bytes) * 100);
}

export function fileVm(
  item: DownloadItem,
  queue: QueueInfo,
  state: EngineState,
  mode: ViewMode,
  present: Set<string>,
): FileVm {
  const name = displayName(item);
  const ext = (name.includes(".") ? name.split(".").pop()! : "").toUpperCase().slice(0, 4);
  const isMedia = MEDIA.includes(ext);
  const exact = percent(item);
  const pct = Math.floor(exact);
  const done = item.status === "completed";
  const missing = done && !!item.file_name && !present.has(item.file_name);
  const active = item.status === "downloading";
  const waiting = item.status === "queued" && queue.settings.paused;
  const speed = state.speeds[item.id] ?? 0;
  const total = item.total_bytes;
  const etaS = total && speed ? (total - item.downloaded) / speed : Infinity;
  const queuedIds = queue.downloads.filter((id) => state.downloads[id]?.status === "queued");

  let status = missing ? "Missing" : "Done";
  if (active) {
    status = total
      ? `${pct}% · ${formatSpeed(speed)} · ${formatEta(etaS)}`
      : `${formatSize(item.downloaded)} · ${formatSpeed(speed)}`;
  } else if (waiting) status = `Queue paused · ${pct}%`;
  else if (item.status === "queued") status = `Queued #${queuedIds.indexOf(item.id) + 1}`;
  else if (item.status === "paused") status = `Paused · ${pct}%`;
  else if (item.status === "failed") status = `Failed at ${pct}%`;
  if (mode === "Icons") {
    if (done && !missing) status = formatSize(total ?? item.downloaded);
    else if (active && total) status = `${pct}% · ${formatEta(etaS)} left`;
  }

  const failed = item.status === "failed";
  const action: FileAction | null = done
    ? null
    : failed
      ? "retry"
      : item.status === "paused"
        ? "resume"
        : "pause";
  const sizeLabel = total ? formatSize(total) : item.downloaded ? formatSize(item.downloaded) : "—";
  let info = `${name} — ${formatSize(item.downloaded)}${total ? " of " + formatSize(total) : ""} · ${item.url}`;
  if (failed && item.error) info += ` · ${item.error}`;

  return {
    id: item.id,
    name,
    ext,
    status,
    sizeLabel,
    pct: exact,
    color: failed ? "var(--danger)" : active ? "var(--accent)" : "var(--muted)",
    nameColor: failed ? "var(--danger)" : missing ? "var(--muted)" : "var(--ink)",
    isMedia,
    done,
    missing,
    hue: hueOf(item.id),
    showBar: !done,
    action,
    actionLabel: action === "retry" ? "Retry" : action === "resume" ? "Resume" : "Pause",
    info,
    path: item.file_name ? joinPath(queue.dir, item.file_name) : null,
  };
}

/** Download totals for the queue at `dir`, or for every queue under it when `deep`. */
export function stats(state: EngineState, dir: string, deep: boolean): Stats {
  const items: DownloadItem[] = [];
  for (const queue of Object.values(state.queues)) {
    if (deep ? isWithin(queue.dir, dir) : queue.dir === dir) {
      for (const id of queue.downloads) {
        const item = state.downloads[id];
        if (item) items.push(item);
      }
    }
  }
  let total = 0;
  let got = 0;
  let speed = 0;
  let active = 0;
  let queued = 0;
  let done = 0;
  for (const item of items) {
    total += item.total_bytes ?? item.downloaded;
    got += item.status === "completed" ? (item.total_bytes ?? item.downloaded) : item.downloaded;
    if (item.status === "downloading") {
      active++;
      speed += state.speeds[item.id] ?? 0;
    } else if (item.status === "queued") queued++;
    else if (item.status === "completed") done++;
  }
  return {
    total,
    pct: total ? (got / total) * 100 : 0,
    active,
    queued,
    done,
    speed,
    pending: items.length - done,
  };
}

export function queueForDir(state: EngineState, dir: string): QueueInfo | undefined {
  return Object.values(state.queues).find((q) => q.dir === dir);
}

export function folderVm(
  state: EngineState,
  parent: string,
  folder: { name: string; items: number },
): FolderVm {
  const path = joinPath(parent, folder.name);
  const st = stats(state, path, true);
  const hasQueue = Object.values(state.queues).some((q) => isWithin(q.dir, path));
  const ownPaused = queueForDir(state, path)?.settings.paused ?? false;
  const paused = ownPaused && st.pending > 0;

  let sub = "";
  if (paused) sub = `Paused · ${st.pending} waiting`;
  else if (st.active) sub = `${st.active} ↓ · ${formatSpeed(st.speed)}`;
  else if (st.queued) sub = `${st.queued} queued`;

  return {
    name: folder.name,
    path,
    sub,
    sizeLabel: st.total ? formatSize(st.total) : "—",
    active: paused ? 0 : st.active,
    paused,
    showBar: st.pending > 0,
    pct: st.pct,
    barColor: st.active ? "var(--accent)" : "var(--muted)",
    tint: paused ? "var(--muted)" : "var(--accent)",
    hasQueue,
  };
}
