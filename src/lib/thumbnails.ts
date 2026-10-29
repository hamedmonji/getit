// Thumbnails for the icons of images and videos.

import { engine } from "./engine";
import { isMediaKind } from "./fileKind";
import type { FileVm } from "./viewModels";

/** Thumbnails are made at this many pixels, enough for the large icon on Retina screens. */
export const THUMBNAIL_SIZE = 256;

/** How much of a video must have arrived, from its start, before a thumbnail is made from it. */
export const PARTIAL_MIN_BYTES = 8 * 1024 * 1024;

/** How many times a thumbnail is made while a video downloads, at equal steps through it. */
const PARTIAL_STEPS = 4;

export interface ThumbnailSource {
  /** The file to read: the finished one, or the `.part` file still downloading. */
  path: string;
  /** For a partial file, how much has arrived from its start (0–1); null for a finished one. */
  available: number | null;
  /** Names this thumbnail: the same while it would come out the same. */
  key: string;
}

/**
 * Where `vm`'s icon gets its thumbnail: a finished image or video still on
 * disk, or a video downloading that has enough from its start to show a frame,
 * made again at each step of the way. Null when it has none.
 */
export function thumbnailSource(
  vm: Pick<FileVm, "kind" | "done" | "missing" | "path" | "size" | "readable">,
): ThumbnailSource | null {
  if (!isMediaKind(vm.kind) || !vm.path || vm.missing) return null;
  if (vm.done) return { path: vm.path, available: null, key: vm.path };
  if (vm.kind !== "video" || !vm.size || vm.readable < PARTIAL_MIN_BYTES) return null;
  const available = Math.min(1, vm.readable / vm.size);
  const step = Math.floor(available * PARTIAL_STEPS);
  const path = `${vm.path}.part`;
  return { path, available, key: `${path}#${step}` };
}

/** Object URLs of thumbnails by key, null where none could be made; each is asked for once. */
const cache = new Map<string, Promise<string | null>>();

/** An object URL for the thumbnail from `source`, or null if it has none. */
export function loadThumbnail(source: ThumbnailSource): Promise<string | null> {
  let url = cache.get(source.key);
  if (!url) {
    url = engine.thumbnail(source.path, THUMBNAIL_SIZE, source.available).then(
      (bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
      () => null,
    );
    cache.set(source.key, url);
  }
  return url;
}
