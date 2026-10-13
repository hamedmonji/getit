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

/** Folders from `home` down to `path`, for the breadcrumbs. */
export function crumbsFrom(home: string, path: string): { label: string; path: string }[] {
  const crumbs = [{ label: "~", path: home }];
  if (!isWithin(path, home) || path === home) return crumbs;
  let current = home;
  for (const part of path.slice(home.length + 1).split("/").filter(Boolean)) {
    current = joinPath(current, part);
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}
