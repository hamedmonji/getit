// Types and commands mirroring the Rust engine (engine/src/types.rs) and the
// Tauri commands in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";

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
  /** Started on its own rather than by its queue. */
  manual: boolean;
  added_at: number;
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
  addDownload: (dir: string, url: string) => invoke<DownloadId>("add_download", { dir, url }),
  pause: (id: DownloadId) => invoke<void>("pause_download", { id }),
  /** Starts a paused or failed download on its own, outside its queue. */
  resume: (id: DownloadId) => invoke<void>("resume_download", { id }),
  /** Puts paused or failed downloads back in line; their queue starts them when it has room. */
  requeue: (ids: DownloadId[]) => invoke<void>("requeue_downloads", { ids }),
  /**
   * Moves downloads (with their finished files) and folders (with everything in
   * them, removing their queues) to the Trash.
   */
  moveToTrash: (ids: DownloadId[], paths: string[]) => invoke<void>("move_to_trash", { ids, paths }),
  remove: (id: DownloadId) => invoke<void>("remove_download", { id }),
  /** Creates a "New Queue" subfolder with its own queue; returns its path. */
  createQueue: (parent: string) => invoke<string>("create_queue", { parent }),
  /** Renames a folder (and moves queues inside it); returns the new path. */
  renameFolder: (path: string, name: string) => invoke<string>("rename_folder", { path, name }),
  /** Moves folders, with the queues inside them, into `dest`. */
  moveFolders: (paths: string[], dest: string) => invoke<void>("move_folders", { paths, dest }),
  /** Moves downloads, with their files, to the queue for `dir`. */
  moveDownloads: (ids: DownloadId[], dir: string) => invoke<void>("move_downloads", { ids, dir }),
  setQueueSettings: (queueId: QueueId, settings: QueueSettings) =>
    invoke<void>("set_queue_settings", { queueId, settings }),
  clearCompleted: (queueId: QueueId) => invoke<number>("clear_completed", { queueId }),
  openPath: (path: string) => openPath(path),
  /** The clipboard's text; rejects when it holds no text. */
  readClipboard: () => readText(),
};

export function onEngineEvent(handler: (event: EngineEvent) => void): Promise<UnlistenFn> {
  return listen<EngineEvent>("engine://event", (e) => handler(e.payload));
}

/** Fired when the frontend missed events and should reload the snapshot. */
export function onResync(handler: () => void): Promise<UnlistenFn> {
  return listen("engine://resync", handler);
}
