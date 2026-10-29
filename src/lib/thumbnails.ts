// Thumbnails for the icons of finished images and videos.

import { engine } from "./engine";
import { isMediaKind } from "./fileKind";
import type { FileVm } from "./viewModels";

/** Thumbnails are made at this many pixels, enough for the large icon on Retina screens. */
export const THUMBNAIL_SIZE = 256;

/** The file to show a thumbnail of in `vm`'s icon: a finished image or video still on disk; else null. */
export function thumbnailPath(vm: Pick<FileVm, "kind" | "done" | "missing" | "path">): string | null {
  return isMediaKind(vm.kind) && vm.done && !vm.missing ? vm.path : null;
}

/** Object URLs of thumbnails by path, null where none could be made; each is asked for once. */
const cache = new Map<string, Promise<string | null>>();

/** An object URL for the thumbnail of the file at `path`, or null if it has none. */
export function loadThumbnail(path: string): Promise<string | null> {
  let url = cache.get(path);
  if (!url) {
    url = engine.thumbnail(path, THUMBNAIL_SIZE).then(
      (bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
      () => null,
    );
    cache.set(path, url);
  }
  return url;
}
