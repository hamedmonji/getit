// How files in a folder are ordered on screen. The download order of a queue
// is the engine's and isn't affected.

import type { FileKind } from "./fileKind";
import type { FileVm } from "./viewModels";

export type SortKey = "kind" | "name" | "size" | "added";

export const SORT_LABELS: Record<SortKey, string> = { kind: "Kind", name: "Name", size: "Size", added: "Date Added" };

export const DEFAULT_SORT: SortKey[] = ["kind", "name", "size", "added"];

/** Kinds sort by what they're called, as in Finder. */
const KIND_LABELS: Record<FileKind, string> = {
  archive: "Archive",
  audio: "Audio",
  disc: "Disc image",
  doc: "Document",
  image: "Image",
  pkg: "Package",
  video: "Video",
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const COMPARE: Record<SortKey, (a: FileVm, b: FileVm) => number> = {
  kind: (a, b) => collator.compare(KIND_LABELS[a.kind], KIND_LABELS[b.kind]),
  name: (a, b) => collator.compare(a.name, b.name),
  // Largest first; files of unknown size last.
  size: (a, b) => (b.size ?? -1) - (a.size ?? -1),
  // Newest first.
  added: (a, b) => b.addedAt - a.addedAt,
};

/** `files` sorted by the first key, then the next for ties, and so on. Ties left after all keep their order. */
export function sortFiles(files: FileVm[], order: SortKey[]): FileVm[] {
  return [...files].sort((a, b) => {
    for (const key of order) {
      const c = COMPARE[key](a, b);
      if (c) return c;
    }
    return 0;
  });
}

/**
 * Reads a stored order, or null if it has none of the keys. Unknown or repeated
 * keys are dropped, and keys added since it was saved go at the end.
 */
export function parseSortOrder(raw: string | null): SortKey[] | null {
  if (!raw) return null;
  const known = [...new Set(raw.split(","))].filter((key): key is SortKey => key in SORT_LABELS);
  if (!known.length) return null;
  return [...known, ...DEFAULT_SORT.filter((key) => !known.includes(key))];
}
