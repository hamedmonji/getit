// Onboarding's appearance preview: getit's own views of a pretend home folder
// (made by the `appearance_preview_dir` command), with a download running in it
// so progress shows in the accent.

import type { EngineState } from "../hooks/useEngine";
import type { DirListing, DownloadItem, QueueInfo } from "./engine";
import { joinPath } from "./paths";
import type { Place } from "./sidebar";
import { fileVm, folderVm, overviewList, plainFiles, type FileVm, type FolderVm, type OverviewRow } from "./viewModels";

/** The size getit is drawn at, before it's scaled down to fit. */
export const PREVIEW_SIZE = { width: 820, height: 540 };

/** How much to scale getit down by to fit `available` pixels across; never up. */
export function fitScale(available: number, width: number = PREVIEW_SIZE.width): number {
  return available > 0 ? Math.min(1, available / width) : 1;
}

/** The pretend home's folders that the preview shows. */
export function previewPaths(home: string) {
  const downloads = joinPath(home, "Downloads");
  return {
    downloads,
    movies: joinPath(downloads, "Movies"),
    installers: joinPath(downloads, "Installers"),
    papers: joinPath(downloads, "Papers"),
  };
}

const SETTINGS: QueueInfo["settings"] = {
  max_concurrent: null,
  paused: false,
  retries: 3,
  rename: [],
  schedule: { mode: "any", windows: [] },
};

function running(id: string, queue: string, url: string, total: number, pct: number, startedAt: number): DownloadItem {
  return {
    id,
    queue_id: queue,
    url,
    file_name: url.slice(url.lastIndexOf("/") + 1),
    total_bytes: total,
    downloaded: Math.round((total * pct) / 100),
    status: "downloading",
    resumable: true,
    etag: null,
    last_modified: null,
    error: null,
    added_at: startedAt,
    started_at: startedAt,
  };
}

/** Pretend downloads running in the preview's Downloads and Movies, nowhere on disk. */
export function previewState(home: string): EngineState {
  const { downloads, movies } = previewPaths(home);
  const items = [
    running("preview-iso", "preview-downloads", "https://example.com/ubuntu-24.04.iso", 6_100_000_000, 64, 2),
    running("preview-mkv", "preview-movies", "https://example.com/cosmos_s01e03.mkv", 1_380_000_000, 30, 1),
  ];
  const queue = (id: string, dir: string): QueueInfo => ({
    id,
    dir,
    settings: SETTINGS,
    downloads: items.filter((d) => d.queue_id === id).map((d) => d.id),
    schedule_closed: false,
    started: [],
  });
  return {
    queues: {
      "preview-downloads": queue("preview-downloads", downloads),
      "preview-movies": queue("preview-movies", movies),
    },
    downloads: Object.fromEntries(items.map((d) => [d.id, d])),
    speeds: { "preview-iso": 18_400_000, "preview-mkv": 9_200_000 },
    saveError: null,
    loaded: true,
  };
}

/** What the preview's views show, from the listing of the pretend Downloads. */
export interface PreviewContent {
  /** The sidebar's chosen folder: the pretend Downloads. */
  roots: Place[];
  favorites: Place[];
  /** The sidebar's running downloads. */
  running: OverviewRow[];
  folders: FolderVm[];
  files: FileVm[];
  /** A folder shown selected, so the selection's colour shows. */
  selected: string;
}

export function previewContent(home: string, listing: Pick<DirListing, "folders" | "visible">): PreviewContent {
  const paths = previewPaths(home);
  const state = previewState(home);
  const queue = state.queues["preview-downloads"];
  const place = (path: string, name: string): Place => ({ name, path, file: false });
  const files = [
    ...queue.downloads.map((id) => fileVm(state.downloads[id], queue, state, "Icons", null)),
    ...plainFiles(paths.downloads, listing.visible, Object.values(state.downloads), "Icons"),
  ];
  return {
    roots: [place(paths.downloads, "Downloads")],
    favorites: [place(paths.movies, "Movies"), place(paths.installers, "Installers"), place(paths.papers, "Papers")],
    running: overviewList(state, home, "active"),
    folders: [...listing.folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => folderVm(state, joinPath(paths.downloads, f.name))),
    files,
    selected: paths.movies,
  };
}
