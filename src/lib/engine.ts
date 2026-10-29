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
  /** The name the server gave before it was added, shown until it starts and gets `file_name`. */
  suggested_name?: string | null;
  /** The name the server gave, before the queue's auto rename or the user renamed it; absent until known. */
  original_name?: string | null;
}

export interface Segment {
  start: number;
  end: number;
  downloaded: number;
}

export interface QueueSettings {
  /** How many downloads may run at once, or null for no limit. */
  max_concurrent: number | null;
  paused: boolean;
  /** How many times in a row a download retries network trouble before it fails. */
  retries: number;
  /** Applied in order to new downloads' names, without the extension. */
  rename: RenameRule[];
}

/** Text to find in a name: as it is, or as a regular expression. */
export interface Pattern {
  text: string;
  regex: boolean;
}

/** One step of a queue's auto rename. */
export type RenameRule =
  | { op: "prefix"; text: string }
  | { op: "suffix"; text: string }
  | { op: "remove"; pattern: Pattern }
  | { op: "replace"; pattern: Pattern; with: string };

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

/** What the server says about a link before it's downloaded. */
export interface LinkInfo {
  /** The name a download of it would get, before a free name is picked in its folder. */
  file_name: string;
  /** Its size, when the server tells. */
  total_bytes: number | null;
  /** The server's name, when `file_name` was renamed before adding it. */
  original_name?: string | null;
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
  /** Where the browser opens: the chosen root, else a test folder in development, Documents on macOS, home elsewhere. */
  initialDir: () => invoke<string>("initial_dir"),
  listDir: (path: string) => invoke<DirListing>("list_dir", { path }),
  /** The first-launch choice: a root folder, or null for Full Disk Access, plus folders added in Settings; null overall before the user chose. */
  accessSetup: () => invoke<{ root: string | null; folders: string[] } | null>("access_setup"),
  /** Remembers the first-launch choice: `root` as the top folder, or null for Full Disk Access. */
  setAccessSetup: (root: string | null) => invoke<void>("set_access_setup", { root }),
  /** Replaces the folders added in Settings that getit may open, besides the root. */
  setAccessFolders: (folders: string[]) => invoke<void>("set_access_folders", { folders }),
  /** Forgets the first-launch choice so onboarding shows again; development builds only. */
  resetAccessSetup: () => invoke<void>("reset_access_setup"),
  /** Whether getit has Full Disk Access; macOS may apply a new grant only after a restart. */
  fullDiskAccess: () => invoke<boolean>("full_disk_access"),
  /** The file name the server gives `url`; rejects if it can't be reached. */
  probeLink: (url: string) => invoke<LinkInfo>("probe_link", { url }),
  /** `names` as the queue for `dir` would name new downloads with its auto rename. */
  autoNames: (dir: string, names: string[]) => invoke<string[]>("auto_names", { dir, names }),
  /** What auto rename `rules` make of `names`, and what's wrong with each rule's regex (such rules are skipped). */
  previewRename: (names: string[], rules: RenameRule[]) =>
    invoke<{ names: string[]; errors: (string | null)[] }>("preview_rename", { names, rules }),
  /** Whether `name` is taken in `dir` by a file or a partial download. */
  fileExists: (dir: string, name: string) => invoke<boolean>("file_exists", { dir, name }),
  /** Adds a link to the queue for `dir`: in line if the queue runs, started right away if it's paused. */
  addDownload: (dir: string, url: string, info: LinkInfo | null = null) =>
    invoke<DownloadId>("add_download", { dir, url, info }),
  /** Links the browser extension sent before the window listened for them; call once listening. */
  takeBrowserLinks: () => invoke<Captured[]>("take_browser_links"),
  /** Gives a download that isn't running or finished a new link, keeping its partial file. */
  setDownloadUrl: (id: DownloadId, url: string) => invoke<void>("set_download_url", { id, url }),
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
  chooseFolder: (path: string, title: string) =>
    open({ directory: true, defaultPath: path, title }) as Promise<string | null>,
  /** Opens macOS's Privacy & Security settings at Full Disk Access. */
  openFullDiskAccessSettings: () =>
    openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"),
  /** getit's `.app` bundle, to drag into the Full Disk Access list; null when not run from one, as in development. */
  appBundle: () => invoke<string | null>("app_bundle"),
  /**
   * A PNG thumbnail of the image or video at `path`, at most `size` px on its longer side;
   * rejects if none can be made. `available` is how much of a partial file has arrived from its start (0–1).
   */
  thumbnail: (path: string, size: number, available: number | null = null) =>
    invoke<ArrayBuffer>("thumbnail", { path, size, available }),
  /** Limits how fast all downloads together receive data, in bytes per second; null lifts the limit. */
  setSpeedLimit: (limit: number | null) => invoke<void>("set_speed_limit", { limit }),
  /** Quits and opens getit again, which macOS may need before Full Disk Access applies. */
  relaunch: () => invoke<void>("relaunch"),
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
