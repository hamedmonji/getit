// Views: saved filters over every download, whatever folder it's in, shown
// in the sidebar. From the v7 Views design handoff.

import type { EngineState } from "../hooks/useEngine";
import type { DownloadItem, QueueInfo } from "./engine";
import { type FileKind, resolveKind } from "./fileKind";
import { formatSize } from "./format";
import { baseName } from "./paths";
import { displayName, fileVm, stats, type FileVm, type FolderVm, type ViewMode } from "./viewModels";

/** Which downloads a view shows by how far along they are. */
export type ViewStatus = "any" | "progress" | "active" | "done";
/** All matching downloads in one grid, or a folder for each place they're in. */
export type ViewLayout = "flat" | "grouped";

/** A site downloads come from: that host only, or its subdomains too. */
export interface ViewSource {
  domain: string;
  sub: boolean;
}

export interface View {
  id: string;
  name: string;
  /** File kinds shown; with `exts`, either matches. Both empty shows any type. */
  kinds: FileKind[];
  /** Extensions shown, lowercase without the dot. */
  exts: string[];
  /** Sites shown; empty shows downloads from anywhere. */
  sources: ViewSource[];
  status: ViewStatus;
  layout: ViewLayout;
}

/** The kinds offered, in the order the panel shows them. */
export const VIEW_KINDS: [FileKind, string][] = [
  ["video", "Video"],
  ["audio", "Audio"],
  ["archive", "Archive"],
  ["disc", "Disc image"],
  ["pkg", "Installer"],
  ["doc", "Document"],
  ["image", "Image"],
];

export const VIEW_STATUSES: [ViewStatus, string][] = [
  ["any", "Any"],
  ["progress", "In progress"],
  ["active", "Not finished"],
  ["done", "Finished"],
];

export const VIEW_LAYOUTS: [ViewLayout, string][] = [
  ["flat", "Flat"],
  ["grouped", "By folder"],
];

export const NEW_VIEW_NAME = "New view";

/** The views a first launch starts with. */
export const DEFAULT_VIEWS: View[] = [
  { id: "all", name: "All downloads", kinds: [], exts: [], sources: [], status: "any", layout: "grouped" },
  { id: "videos", name: "Videos", kinds: ["video"], exts: [], sources: [], status: "any", layout: "flat" },
];

export const newView = (id: string): View => ({
  id,
  name: NEW_VIEW_NAME,
  kinds: [],
  exts: [],
  sources: [],
  status: "any",
  layout: "grouped",
});

const KINDS = VIEW_KINDS.map(([k]) => k);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Views read back from storage; the defaults when nothing is stored, and anything unreadable left out. */
export function parseViews(raw: string | null): View[] {
  if (raw === null) return DEFAULT_VIEWS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VIEWS;
    return parsed.flatMap((v): View[] => {
      if (typeof v?.id !== "string" || typeof v.name !== "string") return [];
      return [
        {
          id: v.id,
          name: v.name,
          kinds: strings(v.kinds).filter((k): k is FileKind => isOneOf(KINDS, k)),
          exts: strings(v.exts),
          sources: Array.isArray(v.sources)
            ? v.sources.filter((s: unknown): s is ViewSource => typeof (s as ViewSource)?.domain === "string").map(
                (s: ViewSource) => ({ domain: s.domain, sub: !!s.sub }),
              )
            : [],
          status: isOneOf(VIEW_STATUSES.map(([s]) => s), v.status) ? v.status : "any",
          layout: isOneOf(VIEW_LAYOUTS.map(([l]) => l), v.layout) ? v.layout : "grouped",
        },
      ];
    });
  } catch {
    return DEFAULT_VIEWS;
  }
}

/** A link's host without `www.`, or "" when it isn't a link. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A file name's extension, lowercase without the dot; "" when it has none. */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export const sourceMatches = (host: string, source: ViewSource): boolean =>
  host === source.domain || (source.sub && host.endsWith("." + source.domain));

/** Whether a download shows in `view`: its type, its site and how far along it is all match. */
export function matchesView(view: View, item: DownloadItem): boolean {
  const name = displayName(item);
  const anyType = !view.kinds.length && !view.exts.length;
  const type = anyType || view.kinds.includes(resolveKind(name).kind) || view.exts.includes(extOf(name));
  const host = hostOf(item.url);
  const source = !view.sources.length || view.sources.some((s) => sourceMatches(host, s));
  const status =
    view.status === "any" ||
    (view.status === "progress"
      ? item.status === "downloading"
      : (view.status === "done") === (item.status === "completed"));
  return type && source && status;
}

/** Every download in `view`, with its queue, in queue order, queues by folder. */
export function viewItems(state: EngineState, view: View): { item: DownloadItem; queue: QueueInfo }[] {
  return Object.values(state.queues)
    .sort((a, b) => a.dir.localeCompare(b.dir))
    .flatMap((queue) =>
      queue.downloads
        .map((id) => state.downloads[id])
        .filter((item) => item && matchesView(view, item))
        .map((item) => ({ item, queue })),
    );
}

/**
 * What a view shows: in a flat view, or inside one of a grouped view's
 * folders (`folder`), its downloads; otherwise a folder for each place they're
 * in. A flat view's downloads have their folder before their status.
 */
export function viewContents(
  state: EngineState,
  view: View,
  folder: string | null,
  mode: ViewMode,
): { folders: FolderVm[]; files: FileVm[] } {
  const items = viewItems(state, view);
  if (view.layout === "flat") {
    return {
      folders: [],
      files: items.map(({ item, queue }) => {
        const vm = fileVm(item, queue, state, mode, null);
        return { ...vm, status: `${baseName(queue.dir) || queue.dir} · ${vm.status}` };
      }),
    };
  }
  if (folder !== null) {
    return {
      folders: [],
      files: items.filter(({ queue }) => queue.dir === folder).map(({ item, queue }) => fileVm(item, queue, state, mode, null)),
    };
  }
  const dirs = [...new Set(items.map(({ queue }) => queue.dir))];
  return {
    folders: dirs.map((dir) => viewFolderVm(state, dir, items.filter(({ queue }) => queue.dir === dir).map(({ item }) => item))),
    files: [],
  };
}

/** A grouped view's folder: how many of its downloads match, and their progress. */
export function viewFolderVm(state: EngineState, dir: string, items: DownloadItem[]): FolderVm {
  const running = items.filter((i) => i.status === "downloading").length;
  const unfinished = items.filter((i) => i.status !== "completed");
  const total = items.reduce((sum, i) => sum + (i.total_bytes ?? i.downloaded), 0);
  const pct = unfinished.length
    ? unfinished.reduce((sum, i) => sum + (i.total_bytes ? Math.min(100, (i.downloaded / i.total_bytes) * 100) : 0), 0) /
      unfinished.length
    : 0;
  const own = stats(state, dir, false);
  return {
    name: baseName(dir) || dir,
    path: dir,
    sub: running ? `${running} downloading` : `${items.length} ${items.length === 1 ? "download" : "downloads"}`,
    sizeLabel: total ? formatSize(total) : "—",
    active: running,
    paused: false,
    scheduled: false,
    showBar: running > 0,
    pct,
    barColor: own.active ? "var(--tint)" : "var(--ink-muted)",
    hasQueue: true,
  };
}

/** `views` with view `id` changed by `patch`. */
export const updateView = (views: View[], id: string, patch: Partial<View> | ((view: View) => Partial<View>)): View[] =>
  views.map((v) => (v.id === id ? { ...v, ...(typeof patch === "function" ? patch(v) : patch) } : v));

export const removeView = (views: View[], id: string): View[] => views.filter((v) => v.id !== id);

/** A name typed for a view, or the default when it's left blank. */
export const viewName = (typed: string): string => typed.trim() || NEW_VIEW_NAME;

export const toggleKind = (view: View, kind: FileKind): Partial<View> => ({
  kinds: view.kinds.includes(kind) ? view.kinds.filter((k) => k !== kind) : [...view.kinds, kind],
});

/** The extensions in typed text, separated by spaces or commas, without dots or `*.`. */
export function parseExts(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.replace(/^\*?\./, "").toLowerCase().trim())
    .filter((t) => /^[a-z0-9]{1,10}$/.test(t));
}

export const addExts = (view: View, exts: string[]): Partial<View> => ({ exts: [...new Set([...view.exts, ...exts])] });

export const removeExt = (view: View, ext: string): Partial<View> => ({ exts: view.exts.filter((x) => x !== ext) });

/** A typed site as a bare host: no scheme, `*.`, `www.` or path. */
export const normalizeSite = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^\*\./, "")
    .replace(/^www\./, "")
    .split(/[/?#\s]/)[0];

export const isSite = (domain: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);

/**
 * `view`'s sources with `domain` added, once. A site no download came from
 * yet, such as a parent domain typed in, includes its subdomains.
 */
export function addSource(view: View, domain: string, hosts: string[]): Partial<View> {
  if (!isSite(domain) || view.sources.some((s) => s.domain === domain)) return {};
  return { sources: [...view.sources, { domain, sub: !hosts.includes(domain) }] };
}

export const toggleSubdomains = (view: View, domain: string): Partial<View> => ({
  sources: view.sources.map((s) => (s.domain === domain ? { ...s, sub: !s.sub } : s)),
});

export const removeSource = (view: View, domain: string): Partial<View> => ({
  sources: view.sources.filter((s) => s.domain !== domain),
});

/** The hosts downloads came from, each once, sorted. */
export const downloadHosts = (items: DownloadItem[]): string[] =>
  [...new Set(items.map((i) => hostOf(i.url)).filter(Boolean))].sort();

/**
 * Sites to offer for `typed`: the hosts downloads came from and their parent
 * domains, minus those already added, that contain it; a valid site typed that
 * isn't among them comes first, to add as it is.
 */
export function siteOptions(view: View, hosts: string[], typed: string): { value: string; label: string }[] {
  const q = normalizeSite(typed);
  const added = (d: string) => view.sources.some((s) => s.domain === d);
  const candidates = [...new Set([...hosts, ...hosts.map((h) => h.split(".").slice(-2).join("."))])]
    .filter((d) => !added(d))
    .sort();
  const options = candidates.filter((d) => !q || d.includes(q)).map((d) => ({ value: d, label: d }));
  return q && isSite(q) && !candidates.includes(q) && !added(q) ? [{ value: q, label: `Add “${q}”` }, ...options] : options;
}

/** The extensions downloads have that `view` doesn't list yet, sorted. */
export const extSuggestions = (view: View, items: DownloadItem[]): string[] =>
  [...new Set(items.map((i) => extOf(displayName(i))).filter(Boolean))].filter((x) => !view.exts.includes(x)).sort();

/** What the file type section says the view matches. */
export function typesHint(view: View): string {
  const kinds = VIEW_KINDS.filter(([k]) => view.kinds.includes(k)).map(([, l]) => `${l.toLowerCase()} files`);
  const parts = [...kinds, ...view.exts.map((x) => "." + x)];
  return parts.length ? `Matches ${parts.join(", ")}.` : "Any type. Pick kinds or add extensions to narrow the view.";
}

export const layoutHint = (layout: ViewLayout): string =>
  layout === "flat"
    ? "Every matching download in one grid, with its folder under the name."
    : "A folder for each place matching downloads are in. Open one to see its downloads.";

/** A site's badge: its first letter on a colour picked from its name. */
export function siteBadge(domain: string): { letter: string; bg: string; fg: string } {
  let hue = 0;
  for (const ch of domain) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return { letter: (domain[0] ?? "?").toUpperCase(), bg: `oklch(0.92 0.05 ${hue})`, fg: `oklch(0.42 0.1 ${hue})` };
}

/** Where the address bar is in a view: Views, the view, and the folder opened in it. */
export const VIEWS_CRUMB = "views:";
export const viewCrumb = (id: string) => VIEWS_CRUMB + id;

export function viewCrumbs(view: View, folder: string | null): { label: string; path: string; drop: boolean }[] {
  return [
    { label: "Views", path: VIEWS_CRUMB, drop: false },
    { label: view.name, path: viewCrumb(view.id), drop: false },
    ...(folder !== null ? [{ label: baseName(folder) || folder, path: folder, drop: false }] : []),
  ];
}

/** Downloads among `files` whose names contain every word of `query`, ignoring case. */
export function searchFiles(files: FileVm[], query: string): FileVm[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return files.filter((f) => words.every((w) => f.name.toLowerCase().includes(w)));
}

/** `views` with `view` put back at `index`, unless one with its id is there already. */
export const restoreView = (views: View[], view: View, index: number): View[] =>
  views.some((v) => v.id === view.id) ? views : [...views.slice(0, index), view, ...views.slice(index)];
