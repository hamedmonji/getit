// Path helpers for the folder browser. Paths are absolute and use "/" (macOS/Linux).

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : dir + "/" + name;
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
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
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : dir + "/");
}

/** Shows paths under the home folder as `~/…`. */
export function displayPath(path: string, home: string): string {
  if (path === home) return "~";
  return isWithin(path, home) ? "~" + path.slice(home.length) : path;
}

/** The last part of `path`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || "/";
}

/** Whether address-bar text is a path to go to rather than a search. */
export function isPathLike(raw: string): boolean {
  return /^[~/]/.test(raw.trim());
}

/** Address-bar text as an absolute path: expands `~` and resolves `.`, `..` and extra slashes. */
export function resolvePath(raw: string, home: string): string {
  let path = raw.trim();
  if (path === "~" || path.startsWith("~/")) path = home + path.slice(1);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}

/**
 * Breadcrumbs for `path`: from `top` (the chosen root, or home) for paths
 * under it, labelled with its name ("~" for home); from home for other paths
 * under home; from the file system's root otherwise.
 */
export function crumbsFrom(home: string, path: string, top: string = home): { label: string; path: string }[] {
  const start = isWithin(path, top) ? top : isWithin(path, home) ? home : "/";
  const crumbs = [{ label: start === home ? "~" : start === "/" ? "/" : baseName(start), path: start }];
  let current = start;
  for (const part of path.slice(start.length).split("/").filter(Boolean)) {
    current = joinPath(current, part);
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

/** Whether Up goes anywhere from `path`: it stops at `top` (the chosen root, or home), at home, and at the file system's root. */
export function canGoUp(path: string, home: string, top: string = home): boolean {
  return path !== top && path !== home && path !== "/";
}
