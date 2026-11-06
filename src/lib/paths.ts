// Path helpers for the folder browser. Paths are absolute, as the backend gives
// them: "/" separated on macOS and Linux, and on Windows "\" separated from a
// drive (`C:\`) or a network share (`\\server\share\`). Each helper reads the
// style from the path itself, so the same code serves both.

const DRIVE = /^[A-Za-z]:[\\/]/;

/** Whether `path` is a Windows path: on a drive, or on a network share. */
const isWindowsPath = (path: string): boolean => DRIVE.test(path) || path.startsWith("\\\\");

/** The separator `path` uses between folders. */
export const separatorOf = (path: string): string => (isWindowsPath(path) ? "\\" : "/");

/** Where the last separator in `path` is, or -1. Windows paths take either slash. */
function lastSeparator(path: string): number {
  return isWindowsPath(path) ? Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) : path.lastIndexOf("/");
}

/** Whether `path` is absolute, on any platform. */
export const isAbsolutePath = (path: string): boolean => path.startsWith("/") || isWindowsPath(path);

/** The top of the file system `path` is on: `/`, a drive (`C:\`) or a share (`\\server\share\`). */
export function rootOf(path: string): string {
  if (DRIVE.test(path)) return path.slice(0, 2) + "\\";
  if (path.startsWith("\\\\")) {
    const [server, share] = path.slice(2).split(/[\\/]/);
    return server && share ? `\\\\${server}\\${share}\\` : path;
  }
  return "/";
}

/** The folders and file `path` goes through below its root, in order. */
export function pathParts(path: string): string[] {
  if (!isWindowsPath(path)) return path.split("/").filter(Boolean);
  return path
    .slice(rootOf(path).length)
    .split(/[\\/]/)
    .filter(Boolean);
}

export function joinPath(dir: string, name: string): string {
  const sep = separatorOf(dir);
  const ends = dir.endsWith(sep) || (sep === "\\" && dir.endsWith("/"));
  return ends ? dir + name : dir + sep + name;
}

export function parentPath(path: string): string {
  const root = rootOf(path);
  const i = lastSeparator(path);
  return i < root.length ? root : path.slice(0, i);
}

/** Archive extensions made of two parts, kept together when renaming. */
const COMPOUND_EXTENSIONS = [".tar.gz", ".tar.xz", ".tar.bz2", ".tar.zst"];

/**
 * Splits a file name into the part a rename edits and its extension:
 * `report.pdf` → `["report", ".pdf"]`, `repo.tar.gz` → `["repo", ".tar.gz"]`.
 * A name without a dot, or a dotfile like `.bashrc`, is all stem.
 */
export function splitName(name: string): [string, string] {
  const lower = name.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((ext) => lower.endsWith(ext) && lower.length > ext.length);
  const i = compound ? name.length - compound.length : name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

/** Whether `path` is `dir` itself or somewhere inside it. */
export function isWithin(path: string, dir: string): boolean {
  const sep = separatorOf(dir);
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

/** A folder moved from one path to another. */
export type Move = [from: string, to: string];

/** Where `path` is after the folder at `from` moved to `to`: unchanged unless it's `from` or inside it. */
export function relocatePath(path: string, [from, to]: Move): string {
  return isWithin(path, from) ? to + path.slice(from.length) : path;
}

/** The moves of folders at `paths` into `dest`; ones already there don't move. */
export const folderMoves = (paths: string[], dest: string): Move[] =>
  paths.filter((path) => parentPath(path) !== dest).map((path) => [path, joinPath(dest, baseName(path))]);

/** Where `path` is after each of `moves`, in turn. */
export const relocateAll = (path: string, moves: Move[]): string => moves.reduce(relocatePath, path);

/** Shows paths under the home folder as `~/…` (`~\…` on Windows). */
export function displayPath(path: string, home: string): string {
  if (path === home) return "~";
  return isWithin(path, home) ? "~" + path.slice(home.length) : path;
}

/** The last part of `path`; for a root, `/`, or the drive or share without its last separator (`C:`). */
export function baseName(path: string): string {
  const root = rootOf(path);
  if (path.length <= root.length) return root === "/" ? "/" : root.slice(0, -1);
  return path.slice(lastSeparator(path) + 1) || "/";
}

/** Whether address-bar text is a path to go to rather than a search. */
export function isPathLike(raw: string): boolean {
  const text = raw.trim();
  return /^[~/\\]/.test(text) || /^[A-Za-z]:([\\/]|$)/.test(text);
}

/**
 * Address-bar text as an absolute path: expands `~` and resolves `.`, `..` and
 * extra separators. With a Windows home either slash separates, `C:` is the
 * top of that drive, and `\x` is on the home's drive.
 */
export function resolvePath(raw: string, home: string): string {
  let path = raw.trim();
  const windows = isWindowsPath(home);
  if (path === "~" || path.startsWith("~/") || (windows && path.startsWith("~\\"))) path = home + path.slice(1);
  if (windows) {
    if (/^[A-Za-z]:([^\\/]|$)/.test(path)) path = path.slice(0, 2) + "\\" + path.slice(2);
    else if (/^[\\/](?![\\/])/.test(path)) path = rootOf(home) + path.slice(1);
  }
  const root = rootOf(path);
  const parts: string[] = [];
  for (const part of pathParts(path)) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return root + parts.join(separatorOf(root));
}

/**
 * Breadcrumbs for `path`: from `top` (the chosen root, or home) for paths
 * under it, labelled with its name ("~" for home); from home for other paths
 * under home; from the file system's root otherwise.
 */
export function crumbsFrom(home: string, path: string, top: string = home): { label: string; path: string }[] {
  const start = isWithin(path, top) ? top : isWithin(path, home) ? home : rootOf(path);
  const crumbs = [{ label: start === home ? "~" : baseName(start), path: start }];
  let current = start;
  const rest = path.slice(start.length).split(isWindowsPath(path) ? /[\\/]/ : "/");
  for (const part of rest.filter(Boolean)) {
    current = joinPath(current, part);
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

/** What follows the breadcrumb for the folder at `path`: its separator, except after `/`, which is one itself. */
export const crumbSeparator = (path: string): string => (path === "/" ? "" : separatorOf(path));

/** Whether Up goes anywhere from `path`: it stops at `top` (the chosen root, or home), at home, and at the file system's root. */
export function canGoUp(path: string, home: string, top: string = home): boolean {
  return path !== top && path !== home && path !== rootOf(path);
}
