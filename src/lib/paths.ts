// Path helpers for the folder browser. Paths are absolute and use "/" (macOS/Linux).

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : dir + "/" + name;
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
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

/** Folders from `home` (or the root, outside it) down to `path`, for the address bar. */
export function crumbsFrom(home: string, path: string): { label: string; path: string }[] {
  const inHome = isWithin(path, home);
  const root = inHome ? home : "/";
  const crumbs = [{ label: inHome ? "~" : "/", path: root }];
  let current = root;
  for (const part of path.slice(root.length).split("/").filter(Boolean)) {
    current = joinPath(current, part);
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}
