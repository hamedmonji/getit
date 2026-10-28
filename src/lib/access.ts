// The folders getit may open without Full Disk Access, as chosen in Settings.

import { isWithin } from "./paths";

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
