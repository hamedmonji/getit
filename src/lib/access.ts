// The folders getit may open without Full Disk Access, as chosen in Settings.

import { isWithin, relocateAll, type Move } from "./paths";

/** The folder chosen as the top (null for none), and the folders added since. */
export interface AccessChoice {
  root: string | null;
  folders: string[];
}

/** Whether two lists of folders are the same, in the same order. */
export const sameFolders = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((f, i) => f === b[i]);

/**
 * `folders` with `path` added, unless the root or one of them already covers
 * it; folders inside `path` go, since it covers them now.
 */
export function addFolder(folders: string[], root: string | null, path: string): string[] {
  if ((root && isWithin(path, root)) || folders.some((f) => isWithin(path, f))) return folders;
  return [...folders.filter((f) => !isWithin(f, path)), path];
}

/** The deepest folder that holds every one of `paths`. */
export function commonFolder(paths: string[]): string {
  const parts = paths.map((p) => p.split("/").filter(Boolean));
  const shared: string[] = [];
  for (let i = 0; parts.every((p) => i < p.length && p[i] === parts[0][i]); i++) shared.push(parts[0][i]);
  return "/" + shared.join("/");
}

/**
 * The folder Up stops at: home with Full Disk Access or without a chosen root;
 * else the root, or the folder holding it and the folders added since.
 */
export function accessTop(home: string, root: string | null, folders: string[], fullDisk: boolean): string {
  if (fullDisk || !root) return home;
  return commonFolder([root, ...folders]);
}

/**
 * The chosen folders to show in `cwd` whatever the folder filter: all of them
 * other than `cwd` itself, when `cwd` is the folder Up stops at without Full
 * Disk Access. Ones deeper down show there too, so each is a click away.
 */
export function accessShortcuts(
  cwd: string,
  home: string,
  root: string | null,
  folders: string[],
  fullDisk: boolean,
): string[] {
  if (fullDisk || !root || cwd !== accessTop(home, root, folders, fullDisk)) return [];
  return [root, ...folders].filter((f) => f !== cwd);
}

/**
 * The root and added folders where they are after folders moved or were
 * renamed, so getit can still open them by their new paths.
 */
export function relocateAccess(
  root: string | null,
  folders: string[],
  moves: Move[],
): AccessChoice {
  return { root: root && relocateAll(root, moves), folders: folders.map((f) => relocateAll(f, moves)) };
}

/** The drive `path` is on: the volume under /Volumes, else the startup drive. */
export function volumeOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "Volumes" && parts.length > 1 ? `/Volumes/${parts[1]}` : "/";
}

/**
 * The chosen `folders` that were deleted: missing from `existing`, though
 * their drive is there. Ones on a drive that's unplugged aren't gone.
 */
export const goneFolders = (folders: string[], existing: Set<string>): string[] =>
  folders.filter((f) => !existing.has(f) && existing.has(volumeOf(f)));

/**
 * The root and added folders without the ones in `removed` or inside them.
 * A removed root gives way to the first added folder left; with none, there's
 * no root, and the user chooses one again.
 */
export function forgetAccess(
  root: string | null,
  folders: string[],
  removed: string[],
): AccessChoice {
  const gone = (path: string) => removed.some((r) => isWithin(path, r));
  const left = folders.filter((f) => !gone(f));
  if (!root || !gone(root)) return { root, folders: left };
  return { root: left[0] ?? null, folders: left.slice(1) };
}
