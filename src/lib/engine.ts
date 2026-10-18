// Types and commands mirroring the Rust engine (engine/src/types.rs) and the
// Tauri commands in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

export type DownloadId = string;
export type QueueId = string;

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed";

export interface DownloadItem {
  id: DownloadId;
  queue_id: QueueId;
  url: string;
  file_name: string | null;
  total_bytes: number | null;
  downloaded: number;
  status: DownloadStatus;
  resumable: boolean | null;
  etag: string | null;
  last_modified: string | null;
  error: string | null;
  added_at: number;
  /** When it last started running, by its queue or by being resumed; absent until it first runs. */
  started_at?: number | null;
  /** Byte ranges downloaded in parallel; absent for a single-connection download. */
  segments?: Segment[];
  /** Name given while it was running; its file is renamed when it stops. */
  rename_to?: string | null;
}

export interface Segment {
  start: number;
  end: number;
  downloaded: number;
}

export interface QueueSettings {
  max_concurrent: number;
  paused: boolean;
}

export interface QueueInfo {
  id: QueueId;
  dir: string;
  settings: QueueSettings;
  downloads: DownloadId[];
}

export type EngineEvent =
  | { type: "queue_changed"; data: QueueInfo }
  | { type: "queue_removed"; data: { id: QueueId } }
  | { type: "download_added"; data: DownloadItem }
  | { type: "download_changed"; data: DownloadItem }
  | { type: "download_removed"; data: { id: DownloadId; queue_id: QueueId } }
  | {
      type: "progress";
      data: { id: DownloadId; downloaded: number; total: number | null; speed_bps: number };
    }
  | { type: "save_failed"; data: { queue_id: QueueId; error: string } };

/** What `moveToTrash` moved; `restoreFromTrash` puts it back. */
export interface Trashed {
  downloads: unknown[];
  folders: unknown[];
  /** Why trashing stopped early, if it did. What's listed was trashed all the same. */
  error: string | null;
}

export interface Snapshot {
  queues: QueueInfo[];
  downloads: DownloadItem[];
}

export interface DirListing {
  folders: { name: string; items: number }[];
  files: string[];
}

export const engine = {
  snapshot: () => invoke<Snapshot>("snapshot"),
  homeDir: () => invoke<string>("home_dir"),
  /** Where the browser opens: a test folder in development, home otherwise. */
  initialDir: () => invoke<string>("initial_dir"),
  listDir: (path: string) => invoke<DirListing>("list_dir", { path }),
  /** The file name the server gives `url`; rejects if it can't be reached. */
  fileNameFor: (url: string) => invoke<string>("file_name_for", { url }),
  /** Whether `name` is taken in `dir` by a file or a partial download. */
  fileExists: (dir: string, name: string) => invoke<boolean>("file_exists", { dir, name }),
  /** Adds a link to the queue for `dir`: in line if the queue runs, started right away if it's paused. */
  addDownload: (dir: string, url: string) => invoke<DownloadId>("add_download", { dir, url }),
  pause: (id: DownloadId) => invoke<void>("pause_download", { id }),
  /** Starts a waiting, paused or failed download right away, past its queue's limit or pause. */
  resume: (id: DownloadId) => invoke<void>("resume_download", { id }),
  /** Puts paused or failed downloads back in line; their queue starts them when it has room. */
  requeue: (ids: DownloadId[]) => invoke<void>("requeue_downloads", { ids }),
  /**
   * Moves downloads (with their finished files; partial ones are deleted) and
   * folders (with everything in them, removing their queues) to the Trash.
   * Resolves with what was trashed.
   */
  moveToTrash: (ids: DownloadId[], paths: string[]) => invoke<Trashed>("move_to_trash", { ids, paths }),
  /** Puts back what `moveToTrash` moved, with its downloads and queues. */
  restoreFromTrash: (trashed: Trashed) => invoke<void>("restore_from_trash", { trashed }),
  remove: (id: DownloadId) => invoke<void>("remove_download", { id }),
  /** Creates a "New Queue" subfolder with its own queue; returns its path. */
  createQueue: (parent: string) => invoke<string>("create_queue", { parent }),
  /** Renames a folder (and moves queues inside it); returns the new path. */
  renameFolder: (path: string, name: string) => invoke<string>("rename_folder", { path, name }),
  /** Renames a download's file (once it stops, if it's running); returns the new name. */
  renameDownload: (id: DownloadId, name: string) => invoke<string>("rename_download", { id, name }),
  /** Moves folders, with the queues inside them, into `dest`. */
  moveFolders: (paths: string[], dest: string) => invoke<void>("move_folders", { paths, dest }),
  /** Moves downloads, with their files, to the queue for `dir`. */
  moveDownloads: (ids: DownloadId[], dir: string) => invoke<void>("move_downloads", { ids, dir }),
  /** Copies downloads, with their files, to the queue for `dir`; returns the copies' ids. */
  copyDownloads: (ids: DownloadId[], dir: string) => invoke<DownloadId[]>("copy_downloads", { ids, dir }),
  /** Copies folders, with their queues, into `dest`; returns the copies' paths. */
  copyFolders: (paths: string[], dest: string) => invoke<string[]>("copy_folders", { paths, dest }),
  /**
   * Puts a queue's downloads in this order. In a running queue the top ones run,
   * up to its limit; running ones that end up below go back to waiting.
   */
  reorderQueue: (queueId: QueueId, ids: DownloadId[]) => invoke<void>("reorder_queue", { queueId, ids }),
  setQueueSettings: (queueId: QueueId, settings: QueueSettings) =>
    invoke<void>("set_queue_settings", { queueId, settings }),
  clearCompleted: (queueId: QueueId) => invoke<number>("clear_completed", { queueId }),
  openPath: (path: string) => openPath(path),
  /** Shows the items selected in Finder (or the system file manager). */
  reveal: (paths: string[]) => revealItemInDir(paths),
  /**
   * Shows an Open panel at `path` for picking a folder; resolves with the one
   * chosen, or null if cancelled. On macOS, choosing a protected folder there
   * lets getit read it.
   */
  chooseFolder: (path: string) =>
    open({ directory: true, defaultPath: path, title: "Grant getit access to this folder" }) as Promise<string | null>,
  /** Opens macOS's Privacy & Security settings at Files & Folders. */
  openPrivacySettings: () =>
    openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"),
  /** The clipboard's text; rejects when it holds no text. */
  readClipboard: () => readText(),
  writeClipboard: (text: string) => writeText(text),
};

export function onEngineEvent(handler: (event: EngineEvent) => void): Promise<UnlistenFn> {
  return listen<EngineEvent>("engine://event", (e) => handler(e.payload));
}

/** Fired when the frontend missed events and should reload the snapshot. */
export function onResync(handler: () => void): Promise<UnlistenFn> {
  return listen("engine://resync", handler);
}

/** Links the browser extension captured, with the title of the page they came from. */
export interface Captured {
  urls: string[];
  title: string | null;
}

/** Fired when the browser extension sends links to add. */
export function onBrowserLinks(handler: (captured: Captured) => void): Promise<UnlistenFn> {
  return listen<Captured>("browser://links", (e) => handler(e.payload));
}
