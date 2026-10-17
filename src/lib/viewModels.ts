// Turns engine state into what the views display. Ported from the design's
// `fileVm` / `folderStats` logic, using real engine data instead of a simulation.

import type { EngineState } from "../hooks/useEngine";
import type { DownloadItem, QueueInfo } from "./engine";
import { type FileKind, resolveKind } from "./fileKind";
import { formatEta, formatSize, formatSpeed } from "./format";
import { baseName, isWithin, joinPath, parentPath } from "./paths";

export type ViewMode = "Icons" | "List";
export type FileAction = "pause" | "resume" | "retry";

export interface FileVm {
  id: string;
  name: string;
  /** Which file-type icon to draw, and its label. */
  kind: FileKind;
  ext: string;
  status: string;
  sizeLabel: string;
  /** Bytes, for sorting: the total when known, else what's downloaded; null if neither. */
  size: number | null;
  /** When the download was added, in milliseconds since the Unix epoch. */
  addedAt: number;
  /** 0–100. */
  pct: number;
  /** Progress colour: accent while running, danger when failed, muted otherwise. */
  color: string;
  nameColor: string;
  /** Running right now, rather than waiting, paused or finished. */
  active: boolean;
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

/** A download's name, including one given while it runs that its file doesn't have yet. */
export function displayName(item: DownloadItem): string {
  return item.rename_to ?? item.file_name ?? nameFromUrl(item.url);
}

/** The name a download of `url` would likely get, before the server says otherwise. */
export function nameFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url.hostname;
  } catch {
    return raw;
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

/**
 * A link being added that isn't a download yet, shown while the server is asked
 * for its file name or while the user decides about a duplicate.
 */
export function pendingVm(key: string, url: string, name: string | null, status: string): FileVm {
  const shown = name ?? nameFromUrl(url);
  return {
    id: key,
    name: shown,
    ...resolveKind(shown),
    status,
    sizeLabel: "—",
    size: null,
    addedAt: Date.now(),
    pct: 0,
    color: "var(--muted)",
    nameColor: "var(--muted)",
    active: false,
    done: false,
    missing: false,
    hue: hueOf(url),
    showBar: false,
    action: null,
    actionLabel: "",
    info: url,
    path: null,
  };
}

export function fileVm(
  item: DownloadItem,
  queue: QueueInfo,
  state: EngineState,
  mode: ViewMode,
  /** File names in the queue's folder; null when not listed, so none count as missing. */
  present: Set<string> | null,
): FileVm {
  const name = displayName(item);
  const exact = percent(item);
  const pct = Math.floor(exact);
  const done = item.status === "completed";
  const missing = done && !!item.file_name && !!present && !present.has(item.file_name);
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
  } else if (waiting) status = `${pct}%`;
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
      : item.status === "paused" || waiting
        ? "resume"
        : "pause";
  const sizeLabel = total ? formatSize(total) : item.downloaded ? formatSize(item.downloaded) : "—";
  let info = `${name} — ${formatSize(item.downloaded)}${total ? " of " + formatSize(total) : ""} · ${item.url}`;
  if (failed && item.error) info += ` · ${item.error}`;

  return {
    id: item.id,
    name,
    ...resolveKind(name),
    status,
    sizeLabel,
    size: total ?? (item.downloaded || null),
    addedAt: item.added_at,
    pct: exact,
    color: failed ? "var(--danger)" : active ? "var(--accent)" : "var(--muted)",
    nameColor: failed ? "var(--danger)" : missing ? "var(--muted)" : "var(--ink)",
    active,
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

export function folderVm(state: EngineState, path: string): FolderVm {
  const st = stats(state, path, true);
  const hasQueue = Object.values(state.queues).some((q) => isWithin(q.dir, path));
  const ownPaused = queueForDir(state, path)?.settings.paused ?? false;
  const paused = ownPaused && st.pending > 0;

  let sub = "";
  if (st.active) sub = `${st.active} ↓ · ${formatSpeed(st.speed)}`;

  return {
    name: baseName(path),
    path,
    sub,
    sizeLabel: st.total ? formatSize(st.total) : "—",
    active: paused ? 0 : st.active,
    paused,
    showBar: st.pending > 0,
    pct: st.pct,
    barColor: st.active ? "var(--accent)" : "var(--muted)",
    hasQueue,
  };
}

/** Whether `name` contains every word in `words`, ignoring case. */
function matches(name: string, words: string[]): boolean {
  const lower = name.toLowerCase();
  return words.every((w) => lower.includes(w));
}

/**
 * Folders and downloads under `root` (anywhere, when null) whose names match
 * `query`. The folders searched are the listed folder's subfolders and every
 * folder on the way to a queue, from `root` or else from home; the downloads
 * are those of every queue under `root`.
 */
export function searchResults(
  state: EngineState,
  root: string | null,
  /** The folder on screen, whose contents are known. */
  listed: { dir: string; folders: string[]; present: Set<string> },
  home: string,
  query: string,
  mode: ViewMode,
): { folders: FolderVm[]; files: FileVm[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const paths = new Set(listed.folders.map((name) => joinPath(listed.dir, name)));
  const files: FileVm[] = [];
  for (const queue of Object.values(state.queues)) {
    if (root !== null && !isWithin(queue.dir, root)) continue;
    const top = root ?? (isWithin(queue.dir, home) ? home : "/");
    for (let p = queue.dir; p !== top && p !== "/"; p = parentPath(p)) paths.add(p);
    for (const id of queue.downloads) {
      const item = state.downloads[id];
      if (item && matches(displayName(item), words)) {
        files.push(fileVm(item, queue, state, mode, queue.dir === listed.dir ? listed.present : null));
      }
    }
  }
  const folders = [...paths]
    .filter((path) => matches(baseName(path), words))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((path) => folderVm(state, path));
  return { folders, files };
}

/** A queue in the overview, with its running downloads and the queues nested in its folder. */
export interface OverviewNode {
  id: string;
  dir: string;
  /** The queue's folder name. */
  label: string;
  paused: boolean;
  /** Its running downloads, in queue order. */
  files: FileVm[];
  /** How many of its downloads wait their turn. */
  waiting: number;
  speed: number;
  children: OverviewNode[];
}

/**
 * Every queue with a running download, as a tree: a queue goes under the
 * nearest queue in a folder above it that's also listed.
 */
export function overviewTree(state: EngineState, home: string): OverviewNode[] {
  const nodes: OverviewNode[] = Object.values(state.queues)
    .map((queue) => {
      const items = queue.downloads.map((id) => state.downloads[id]).filter(Boolean);
      const running = items.filter((item) => item.status === "downloading");
      return {
        id: queue.id,
        dir: queue.dir,
        label: queue.dir === home ? "Home" : baseName(queue.dir),
        paused: queue.settings.paused,
        files: running.map((item) => fileVm(item, queue, state, "List", null)),
        waiting: items.filter((item) => item.status === "queued").length,
        speed: running.reduce((sum, item) => sum + (state.speeds[item.id] ?? 0), 0),
        children: [],
      };
    })
    .filter((node) => node.files.length > 0)
    .sort((a, b) => (pathKey(a.dir) < pathKey(b.dir) ? -1 : 1));

  const roots: OverviewNode[] = [];
  // Sorted folder by folder, so a queue's ancestors in the list come right before
  // the queues inside them.
  const open: OverviewNode[] = [];
  for (const node of nodes) {
    while (open.length && !isWithin(node.dir, open[open.length - 1].dir)) open.pop();
    const parent = open[open.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    open.push(node);
  }
  return roots;
}

/** Sorts a path's folders before siblings that merely share a prefix (`a/b/c` before `a/b-x`). */
function pathKey(path: string): string {
  return path.split("/").join("\u0000");
}
