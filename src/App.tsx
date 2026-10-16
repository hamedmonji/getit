import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Details } from "./components/Details";
import { Overview } from "./components/Overview";
import { CapturedBar, DuplicatePanel, InputBar, PasteBar, PauseBar, StatusBar, Toolbar, type Theme } from "./components/Bars";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { IconView, ListView, type ItemViewProps } from "./components/ItemViews";
import { useDirListing } from "./hooks/useDirListing";
import { useEngine } from "./hooks/useEngine";
import { useItemDrag } from "./hooks/useItemDrag";
import { useMarquee } from "./hooks/useMarquee";
import { useStoredState } from "./hooks/useStoredState";
import { engine, onBrowserLinks, type DownloadItem, type DownloadStatus, type QueueInfo } from "./lib/engine";
import { formatSize, formatSpeed, plural } from "./lib/format";
import { baseName, crumbsFrom, displayPath, joinPath, parentPath, resolvePath } from "./lib/paths";
import {
  displayName,
  fileVm,
  folderVm,
  nameFromUrl,
  overviewTree,
  pendingVm,
  queueForDir,
  searchResults,
  stats,
  type FileVm,
  type FolderVm,
  type ViewMode,
} from "./lib/viewModels";

/** Links being added that are already downloads, waiting for the user to decide. */
interface Duplicates {
  /** Folder the links were being added to. */
  dir: string;
  items: Duplicate[];
}

/**
 * What a link being added clashes with: a download of the same link anywhere, or
 * in the target folder a download or a file with the name it would get.
 */
type Duplicate = (
  | { url: string; kind: "link" | "name"; existing: DownloadItem }
  | { url: string; kind: "file"; name: string }
) & {
  /** The temporary item shown for the link while it was checked, if any. */
  pendingKey?: string;
};

/** A link being added that isn't a download yet: shown while the server is asked
 * for its file name, and while the user decides about it if it's a duplicate. */
interface PendingAdd {
  key: string;
  url: string;
  dir: string;
  /** The server's name for it, once known. */
  name: string | null;
}

const STATUS_WORDS: Record<DownloadStatus, string> = {
  queued: "Waiting",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Finished",
  failed: "Failed",
};

/** `name` without the ` (1)`, ` (2)`, ... added to keep copies apart, so copies compare equal. */
function withoutCopyNumber(name: string): string {
  return name.replace(/ \(\d+\)(\.[^.]*)?$/, "$1");
}

/** A URL as the engine stores it, so the same link compares equal however it was written. */
function sameUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

interface History {
  cwd: string;
  back: string[];
  forward: string[];
}

/** On macOS, Control-click opens the context menu and Command adds to the selection. */
const IS_MAC = navigator.userAgent.includes("Mac");

/** Prefix for keyboard shortcuts shown in menus. */
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const FILE_MANAGER = IS_MAC ? "Finder" : navigator.userAgent.includes("Windows") ? "Explorer" : "File Manager";

/** How long a failed move's message stays in the status bar. */
const NOTICE_MS = 6000;

/** Most downloads a queue can run at once, as offered in the menu. */
const MAX_CONCURRENCY = 6;

interface Menu {
  x: number;
  y: number;
  /** A folder path or download id; null for the folder's empty space. */
  target: string | null;
}

/** `raw` as an http(s) URL, if it is one. */
function asLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && url.hostname ? raw : null;
  } catch {
    return null;
  }
}

/**
 * One link per line of `text`, each once, in order, for pasting a batch. A line
 * gives its first http(s) link, or is taken whole when it looks like a link
 * without a scheme (`example.com/file.zip`). Other lines are skipped.
 */
function linksIn(text: string): string[] {
  const links: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    let link = tokens.map((t) => (/^https?:\/\//i.test(t) ? asLink(t) : null)).find(Boolean) ?? null;
    if (!link && tokens.length === 1 && /^[^/\s]+\.[a-z]{2,}(\/|$)/i.test(tokens[0])) {
      link = asLink("https://" + tokens[0]);
    }
    if (link) links.push(link);
  }
  return [...new Set(links)];
}

/** A change Command-Z can take back. */
interface Undo {
  /** What it undoes, such as "Move to Trash". */
  label: string;
  run: () => Promise<unknown>;
}

/** How many changes Command-Z can go back through. */
const MAX_UNDOS = 50;

/** Items cut or copied, waiting to be pasted: download ids and folder paths. */
interface Clip {
  keys: string[];
  /** Pasting moves them rather than copying them. */
  cut: boolean;
}

/** Downloads are keyed by id, folders by their absolute path. */
const isFolderKey = (key: string) => key.startsWith("/");

function report(promise: Promise<unknown>) {
  promise.catch((e) => console.error(e));
}

export default function App() {
  const state = useEngine();
  // For code that runs after waiting on the server, which needs the state as it is then.
  const stateRef = useRef(state);
  stateRef.current = state;
  const [home, setHome] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  /** Selected folder paths and download ids. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Where a Shift-click range starts. */
  const [anchor, setAnchor] = useState<string | null>(null);
  /** A selected item pressed without modifiers; selected alone if the press ends without a drag. */
  const pressed = useRef<string | null>(null);
  const select = useCallback((keys: string[]) => {
    setSelected(new Set(keys));
    setAnchor(keys.length === 1 ? keys[0] : null);
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const marquee = useMarquee(contentRef);
  const [adding, setAdding] = useState(false);
  /** Folder whose name is being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Bumped to re-list the folder after changes the engine doesn't report. */
  const [listNonce, setListNonce] = useState(0);
  const [menu, setMenu] = useState<Menu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [theme, setTheme] = useStoredState<Theme>("getit.theme", ["Light", "Dark"], () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "Dark" : "Light",
  );
  const [mode, setMode] = useStoredState<ViewMode>("getit.view", ["Icons", "List"], () => "Icons");
  const [folderFilter, setFolderFilter] = useStoredState<"all" | "queues">(
    "getit.folders",
    ["all", "queues"],
    () => "queues",
  );
  const showAllFolders = folderFilter === "all";
  const toggleFolders = () => setFolderFilter(showAllFolders ? "queues" : "all");
  /** Whether pasting links asks first or adds them right away. */
  const [overviewPanel, setOverviewPanel] = useStoredState<"open" | "closed">(
    "getit.overview",
    ["open", "closed"],
    () => "closed",
  );
  const overviewOpen = overviewPanel === "open";
  const [detailsPanel, setDetailsPanel] = useStoredState<"open" | "closed">(
    "getit.details",
    ["open", "closed"],
    () => "closed",
  );
  const detailsOpen = detailsPanel === "open";
  const toggleDetails = () => setDetailsPanel(detailsOpen ? "closed" : "open");
  const [pasteMode, setPasteMode] = useStoredState<"ask" | "always">("getit.paste", ["ask", "always"], () => "ask");
  /** Links the browser extension captured, waiting to be added to a folder. */
  const [captured, setCaptured] = useState<string[] | null>(null);
  /** Links from the clipboard waiting for the user to confirm. */
  const [pasting, setPasting] = useState<string[] | null>(null);
  /** Downloads waiting for the user to confirm pausing, since they can't resume. */
  const [confirmPause, setConfirmPause] = useState<string[] | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null);
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [clip, setClip] = useState<Clip | null>(null);
  /** Pastes and trashes that can be undone, newest last. */
  const [undos, setUndos] = useState<Undo[]>([]);
  const lastUndo = undos[undos.length - 1];
  /** What cutting or copying last put on the system clipboard; null if that failed. */
  const clipText = useRef<string | null>(null);
  /** Whether the address bar is being typed in. */
  const [addressOpen, setAddressOpen] = useState(false);
  /** The search shown in place of the folder's contents; empty when browsing. */
  const [query, setQuery] = useState("");
  /** Whether the search covers every queue rather than this folder. */
  const [searchAll, setSearchAll] = useState(false);
  useEffect(() => {
    if (!addressOpen && !query) setSearchAll(false);
  }, [addressOpen, query]);

  useEffect(() => {
    Promise.all([engine.homeDir(), engine.initialDir()]).then(([home, start]) => {
      setHome(home);
      setHistory({ cwd: start, back: [], forward: [] });
    });
  }, []);

  const cwd = history?.cwd ?? null;
  useEffect(() => {
    setEditing(null);
    setPasting(null);
    setQuery("");
    setAddressOpen(false);
  }, [cwd]);
  const all = Object.values(state.downloads);
  const refreshKey = [
    all.length,
    all.filter((d) => d.status === "completed").length,
    Object.keys(state.queues).length,
    listNonce,
  ].join(":");
  const listing = useDirListing(cwd, refreshKey);
  /** The folder whose contents are on screen. Lags `cwd` until its listing arrives. */
  const shown = listing.path;

  const go = useCallback(
    (path: string, focus: string | null = null) => {
      setHistory((h) => (h && h.cwd !== path ? { cwd: path, back: [...h.back, h.cwd], forward: [] } : h));
      setQuery("");
      select(focus ? [focus] : []);
    },
    [select],
  );

  const goBack = () => {
    if (!history?.back.length) return;
    const back = [...history.back];
    const cwd = back.pop()!;
    setHistory({ cwd, back, forward: [history.cwd, ...history.forward] });
    select([]);
  };
  const goForward = () => {
    if (!history?.forward.length) return;
    const [cwd, ...forward] = history.forward;
    setHistory({ cwd, back: [...history.back, history.cwd], forward });
    select([]);
  };
  // Up stops at home, or at the root for folders outside it.
  const canUp = !!home && !!cwd && cwd !== home && cwd !== "/";
  const goUp = () => {
    if (canUp && cwd) go(parentPath(cwd), cwd);
  };

  const queue = shown ? queueForDir(state, shown) : undefined;
  const allFolders = useMemo(
    () => (shown ? listing.folders.map((f) => folderVm(state, joinPath(shown, f.name))) : []),
    [state, shown, listing],
  );
  const shownFolders = (list: FolderVm[]) => (showAllFolders ? list : list.filter((g) => g.hasQueue));
  const hiddenFolders = allFolders.length - shownFolders(allFolders).length;
  // Follows the listing, so subfolders and downloads appear together instead of
  // the downloads shifting when the subfolders arrive.
  const folderFiles = useMemo(
    () =>
      queue
        ? queue.downloads
            .map((id) => state.downloads[id])
            .filter(Boolean)
            .map((item) => fileVm(item, queue, state, mode, listing.present))
        : [],
    [state, queue, mode, listing],
  );
  const results = useMemo(
    () =>
      query && shown && home
        ? searchResults(
            state,
            searchAll ? null : shown,
            { dir: shown, folders: listing.folders.map((f) => f.name), present: listing.present },
            home,
            query,
            mode,
          )
        : null,
    [state, shown, listing, home, query, searchAll, mode],
  );
  const folders = shownFolders(results?.folders ?? allFolders);
  const files = results?.files ?? folderFiles;

  /** Every item in view, in display order. */
  const order = [...folders.map((g) => g.path), ...files.map((f) => f.id)];
  /** The selected items that are still in view, in display order. */
  const selection = order.filter((key) => selected.has(key));
  const selectedFiles = files.filter((f) => selected.has(f.id));

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Dropping on a folder moves downloads to its queue and folders inside it.
  const { drag, start: startDrag } = useItemDrag(
    (keys, target) => target !== shown && !keys.includes(target),
    (keys, target) => {
      const ids = keys.filter((key) => key in state.downloads);
      const paths = keys.filter((key) => !(key in state.downloads));
      Promise.allSettled([
        ids.length ? engine.moveDownloads(ids, target) : null,
        paths.length ? engine.moveFolders(paths, target) : null,
      ]).then((results) => {
        const failed = results.find((r) => r.status === "rejected");
        setNotice(failed ? `Couldn't move: ${failed.reason}` : null);
        setListNonce((n) => n + 1);
      });
      select([]);
    },
  );

  // Finder-style: Shift selects a range, Command (Control elsewhere) toggles one item.
  const onItemMouseDown = (key: string, e: ReactMouseEvent) => {
    pressed.current = null;
    if (e.button !== 0 || (e.target as Element).closest("button, input")) return;
    if (IS_MAC && e.ctrlKey) return;
    if (e.shiftKey) {
      const from = order.indexOf(anchor ?? key);
      const to = order.indexOf(key);
      if (from < 0) select([key]);
      else setSelected(new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)));
      return;
    }
    if (IS_MAC ? e.metaKey : e.ctrlKey) {
      const next = new Set(selected);
      if (!next.delete(key)) next.add(key);
      setSelected(next);
      setAnchor(key);
      return;
    }
    if (selected.has(key)) {
      pressed.current = key;
      startDrag(e, selection);
    } else {
      select([key]);
      startDrag(e, [key]);
    }
  };
  // Dragging across empty space selects what the box touches; Shift adds to the
  // selection and Command (Control elsewhere) toggles.
  const onContentMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const onScrollbar = e.clientX - el.getBoundingClientRect().left >= el.clientWidth;
    if (e.button !== 0 || onScrollbar || (IS_MAC && e.ctrlKey)) return;
    if ((e.target as Element).closest("[data-key], input")) return;
    const toggle = IS_MAC ? e.metaKey : e.ctrlKey;
    const base = e.shiftKey || toggle ? new Set(selected) : new Set<string>();
    marquee.start(e, (hits) => {
      const next = new Set(base);
      for (const key of hits) {
        if (toggle && base.has(key)) next.delete(key);
        else next.add(key);
      }
      setSelected(next);
      setAnchor(null);
    });
  };

  const onItemClick = (key: string) => {
    if (pressed.current === key) select([key]);
    pressed.current = null;
  };

  /** Running downloads whose server can't resume them, so pausing starts them over. */
  const losesProgress = (id: string) => {
    const item = state.downloads[id];
    return item?.status === "downloading" && item.resumable === false;
  };
  /** Pauses downloads, asking first about any that would lose their progress. */
  const pauseDownloads = (ids: string[]) => {
    ids.filter((id) => !losesProgress(id)).forEach((id) => report(engine.pause(id)));
    const ask = ids.filter(losesProgress);
    if (ask.length) setConfirmPause(ask);
  };

  const onAction = (vm: FileVm) => {
    if (vm.action === "pause") pauseDownloads([vm.id]);
    else report(engine.resume(vm.id));
  };
  // Finished files open; unfinished downloads show or hide their details instead.
  const onOpenFile = (vm: FileVm) => {
    if (vm.done && !vm.missing && vm.path) report(engine.openPath(vm.path));
    else if (!vm.done && vm.id in state.downloads) toggleDetails();
  };

  /** Where arrow keys move from: the item last reached with them, if still selected. */
  const lead = useRef<string | null>(null);

  /** Items per row in the icon grid, read from the laid-out tiles. */
  const columns = () => {
    const tiles = contentRef.current?.querySelectorAll<HTMLElement>(".icon-grid > [data-key]");
    if (!tiles?.length) return 1;
    let n = 0;
    for (const tile of tiles) {
      if (tile.offsetTop !== tiles[0].offsetTop) break;
      n++;
    }
    return n;
  };

  // Arrows move the selection (Shift extends it), like Finder: up and down move
  // by rows, left and right by items in the icon grid.
  const moveSelection = (key: string, extend: boolean) => {
    const current = lead.current && selected.has(lead.current) ? lead.current : (selection[selection.length - 1] ?? null);
    const index = current === null ? -1 : order.indexOf(current);
    if (mode === "List" && (key === "ArrowLeft" || key === "ArrowRight")) return;
    const forward = key === "ArrowDown" || key === "ArrowRight";
    let next: number;
    if (index < 0) {
      next = forward ? 0 : order.length - 1;
    } else {
      const row = mode === "Icons" ? columns() : 1;
      const delta = { ArrowUp: -row, ArrowDown: row, ArrowLeft: -1, ArrowRight: 1 }[key] ?? 0;
      next = index + delta;
      if (next < 0 || next >= order.length) return;
    }
    const target = order[next];
    if (target === undefined) return;
    if (extend) {
      const from = order.indexOf(anchor ?? current ?? target);
      const start = from < 0 ? next : from;
      setSelected(new Set(order.slice(Math.min(start, next), Math.max(start, next) + 1)));
      setAnchor(order[start]);
    } else {
      select([target]);
    }
    lead.current = target;
    contentRef.current
      ?.querySelector(`[data-key="${CSS.escape(target)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const pushUndo = (undo: Undo) => setUndos((list) => [...list.slice(1 - MAX_UNDOS), undo]);
  /** Takes back the last paste or trash. */
  const undo = () => {
    if (!lastUndo) return;
    setUndos((list) => list.slice(0, -1));
    lastUndo
      .run()
      .then(() => setNotice(null))
      .catch((e) => setNotice(`Couldn't undo: ${e}`))
      .finally(() => setListNonce((n) => n + 1));
  };

  /** Moves downloads (by id) and folders (by path) to the Trash, files and all. */
  const trashItems = (keys: string[]) => {
    if (!keys.length) return;
    const ids = keys.filter((key) => key in state.downloads);
    const paths = keys.filter((key) => !(key in state.downloads));
    engine
      .moveToTrash(ids, paths)
      .then((trashed) => {
        setNotice(trashed.error);
        if (trashed.downloads.length || trashed.folders.length) {
          pushUndo({ label: "Move to Trash", run: () => engine.restoreFromTrash(trashed) });
        }
      })
      .catch((e) => setNotice(String(e)))
      .finally(() => setListNonce((n) => n + 1));
    select([]);
  };

  /** Of several matching downloads, the one in `dir`'s queue, else an unfinished one. */
  const bestMatch = (matches: DownloadItem[], dir: string) => {
    const here = queueForDir(stateRef.current, dir)?.id;
    return matches.find((d) => d.queue_id === here) ?? matches.find((d) => d.status !== "completed") ?? matches[0];
  };

  /** A download of the same link, finished or not, in any queue. Answered from memory. */
  const findByLink = (url: string, dir: string): Duplicate | undefined => {
    const key = sameUrl(url);
    const existing = bestMatch(
      Object.values(stateRef.current.downloads).filter((d) => sameUrl(d.url) === key),
      dir,
    );
    return existing && { url, kind: "link", existing };
  };

  /**
   * A download with the same file name in any queue (signed links differ each
   * time for the same file), ignoring copy numbers; else a file or partial
   * download with that name in `dir`.
   */
  const findByName = async (url: string, name: string, dir: string): Promise<Duplicate | undefined> => {
    const base = withoutCopyNumber(name);
    const existing = bestMatch(
      Object.values(stateRef.current.downloads).filter((d) => withoutCopyNumber(displayName(d)) === base),
      dir,
    );
    if (existing) return { url, kind: "name", existing };
    if (await engine.fileExists(dir, name).catch(() => false)) return { url, kind: "file", name };
    return undefined;
  };

  /** Adds the links' downloads to `dir`, selecting them; rejects with how many failed, if any did. */
  const addNow = async (urls: string[], dir: string) => {
    const ids: string[] = [];
    const failed: unknown[] = [];
    for (const url of urls) {
      try {
        ids.push(await engine.addDownload(dir, url));
      } catch (e) {
        failed.push(e);
      }
    }
    if (ids.length) select(ids);
    if (failed.length === 1 && urls.length === 1) throw failed[0];
    if (failed.length) throw `${plural(failed.length, "link")} of ${urls.length} couldn't be added: ${failed[0]}`;
  };

  /** Asks about these duplicates too, alongside any already being asked about for `dir`. */
  const askAbout = (dir: string, items: Duplicate[]) =>
    setDuplicates((prev) => (prev && prev.dir === dir ? { dir, items: [...prev.items, ...items] } : { dir, items }));

  /** Drops the temporary items of duplicates that have been dealt with. */
  const dropPending = (items: Duplicate[]) => {
    const keys = new Set(items.map((d) => d.pendingKey));
    setPendingAdds((list) => list.filter((p) => !keys.has(p.key)));
  };

  /**
   * Adds links to `dir`, unless they already exist; then the user is asked.
   * Links already in the list are found at once. The rest show as temporary
   * items while the server is asked for their file names, which are checked
   * against other downloads and the files in `dir`; each becomes a download, or
   * stays until the user decides. `again` adds them all without checking.
   * Rejects with how many failed to add, if any did.
   */
  const addLinks = async (urls: string[], dir = cwd, again = false) => {
    if (!dir) return;
    if (again) return addNow(urls, dir);

    const byLink = urls.flatMap((url) => findByLink(url, dir) ?? []);
    if (byLink.length) askAbout(dir, byLink);
    const rest = urls.filter((url) => !byLink.some((d) => d.url === url));
    if (!rest.length) return;

    const pending: PendingAdd[] = rest.map((url) => ({ key: `pending:${crypto.randomUUID()}`, url, dir, name: null }));
    setPendingAdds((list) => [...list, ...pending]);
    const checked = await Promise.all(
      pending.map(async (p) => {
        // The name in the link stands in when the server can't be asked.
        const name = await engine.fileNameFor(p.url).catch(() => nameFromUrl(p.url));
        const duplicate = await findByName(p.url, name, dir);
        return { p, name, duplicate: duplicate && { ...duplicate, pendingKey: p.key } };
      }),
    );

    const byName = checked.flatMap((c) => c.duplicate ?? []);
    if (byName.length) {
      const names = new Map(checked.map((c) => [c.p.key, c.name]));
      setPendingAdds((list) => list.map((p) => (names.has(p.key) ? { ...p, name: names.get(p.key)! } : p)));
      askAbout(dir, byName);
    }
    const fresh = checked.filter((c) => !c.duplicate).map((c) => c.p);
    if (!fresh.length) return;
    try {
      await addNow(
        fresh.map((p) => p.url),
        dir,
      );
    } finally {
      // The downloads have replaced them by now.
      const keys = new Set(fresh.map((p) => p.key));
      setPendingAdds((list) => list.filter((p) => !keys.has(p.key)));
    }
  };

  /** A duplicate's existing download as it is now; null for a file. */
  const currentOf = (d: Duplicate): DownloadItem | null =>
    d.kind === "file" ? null : (state.downloads[d.existing.id] ?? d.existing);
  /** Unfinished and not running, so starting it means something. */
  const canStart = (item: DownloadItem | null) =>
    !!item && (item.status === "queued" || item.status === "paused" || item.status === "failed");

  // Goes to a duplicate's existing download with it selected, or shows its file in Finder.
  const showDuplicate = (dir: string, d: Duplicate) => {
    const item = currentOf(d);
    if (d.kind === "file" || !item) {
      if (d.kind === "file") report(engine.reveal([joinPath(dir, d.name)]));
      return;
    }
    const where = state.queues[item.queue_id]?.dir;
    if (where) go(where, item.id);
  };

  // Starts the existing downloads that aren't finished, then shows the first
  // download; with only files, shows them all in Finder.
  const startExisting = (dir: string, items: Duplicate[]) => {
    for (const d of items) {
      const item = currentOf(d);
      if (item && canStart(item)) report(engine.resume(item.id));
    }
    const first = items.find((d) => d.kind !== "file");
    if (first) showDuplicate(dir, first);
    else report(engine.reveal(items.flatMap((d) => (d.kind === "file" ? [joinPath(dir, d.name)] : []))));
  };

  /** A duplicate's folder as shown in the panel: "This Queue" for the folder on screen. */
  const whereLabel = (dir: string) =>
    dir === cwd ? { where: "This Queue", here: true } : { where: displayPath(dir, home ?? "") };

  /**
   * Deals with some of the duplicates being asked about: starts (or shows) their
   * existing downloads, adds them again, or skips them. The panel stays for the rest.
   */
  const settleDuplicates = (handled: Duplicate[], how: "start" | "add" | "skip") => {
    if (!duplicates) return;
    const { dir } = duplicates;
    const urls = new Set(handled.map((d) => d.url));
    setDuplicates((prev) => {
      const rest = prev?.items.filter((d) => !urls.has(d.url)) ?? [];
      return prev && rest.length ? { ...prev, items: rest } : null;
    });
    if (how === "start") startExisting(dir, handled);
    if (how === "add") {
      addLinks([...urls], dir, true)
        .catch((e) => setNotice(`Couldn't add: ${e}`))
        .finally(() => dropPending(handled));
    } else {
      dropPending(handled);
    }
  };

  /** The folder a download's file goes in. */
  const dirOf = (id: string) => state.queues[state.downloads[id]?.queue_id]?.dir;
  /** Goes to the folder holding a search result, with the result selected. */
  const showInFolder = (key: string) => {
    const dir = key in state.downloads ? dirOf(key) : parentPath(key);
    if (dir) go(dir, key);
  };
  const showInFolderItem = (key: string): MenuItem => ({
    kind: "action",
    label: "Show in Enclosing Folder",
    onSelect: () => showInFolder(key),
  });
  // Unfinished downloads have no file yet, so their folder stands in for them.
  const diskPath = (key: string) => {
    if (isFolderKey(key)) return key;
    const vm = files.find((f) => f.id === key);
    return vm?.done && !vm.missing && vm.path ? vm.path : dirOf(key);
  };
  const revealItem = (keys: string[]): MenuItem => ({
    kind: "action",
    label: `Show in ${FILE_MANAGER}`,
    onSelect: () => {
      const paths = [...new Set(keys.map(diskPath).filter((p): p is string => !!p))];
      if (paths.length) report(engine.reveal(paths));
    },
  });

  // Cut and copy also put the items' paths on the system clipboard, so they can
  // be pasted in other apps, and so copying something else takes over Command-V.
  const clipItems = (keys: string[], cut: boolean) => {
    if (!keys.length) return;
    const text = keys
      .map((key) => (isFolderKey(key) ? key : (files.find((f) => f.id === key)?.path ?? state.downloads[key]?.url)))
      .filter(Boolean)
      .join("\n");
    setClip({ keys, cut });
    clipText.current = text;
    engine.writeClipboard(text).catch(() => (clipText.current = null));
  };

  /** Moves (after a cut) or copies the clipped items into `dest`, selecting them if they land here. */
  const pasteItems = (dest: string) => {
    if (!clip) return;
    const { keys, cut } = clip;
    const ids = keys.filter((key) => !isFolderKey(key) && key in state.downloads);
    const paths = keys.filter(isFolderKey);
    // Where cut downloads came from, for undo; those already here stay put.
    const from = new Map<string, string>();
    for (const id of ids) {
      const dir = state.queues[state.downloads[id].queue_id]?.dir;
      if (dir && dir !== dest) from.set(id, dir);
    }
    const movedPaths = paths.filter((path) => parentPath(path) !== dest);
    const pasted = cut
      ? Promise.all([
          ids.length ? engine.moveDownloads(ids, dest) : null,
          paths.length ? engine.moveFolders(paths, dest) : null,
        ]).then(() => [...paths.map((path) => joinPath(dest, baseName(path))), ...ids])
      : Promise.all([
          paths.length ? engine.copyFolders(paths, dest) : [],
          ids.length ? engine.copyDownloads(ids, dest) : [],
        ]).then(([folders, downloads]) => [...folders, ...downloads]);
    // Cut items move once; copied ones can be pasted again.
    if (cut) setClip(null);
    pasted
      .then((keys) => {
        setNotice(null);
        if (dest === cwd) select(keys);
        if (cut) {
          if (!from.size && !movedPaths.length) return;
          const back = new Map<string, string[]>();
          for (const [id, dir] of from) back.set(dir, [...(back.get(dir) ?? []), id]);
          pushUndo({
            label: "Move",
            run: () =>
              Promise.all([
                ...[...back].map(([dir, ids]) => engine.moveDownloads(ids, dir)),
                ...movedPaths.map((path) => engine.moveFolders([joinPath(dest, baseName(path))], parentPath(path))),
              ]),
          });
        } else if (keys.length) {
          // Copies go to the Trash, as in Finder.
          pushUndo({
            label: "Copy",
            run: () => engine.moveToTrash(keys.filter((key) => !isFolderKey(key)), keys.filter(isFolderKey)),
          });
        }
      })
      .catch((e) => setNotice(`Couldn't paste: ${e}`))
      .finally(() => setListNonce((n) => n + 1));
  };

  // Like Finder's New Folder: create it with a default name, then edit the name in place.
  const newQueue = () => {
    if (!cwd) return;
    engine
      .createQueue(cwd)
      .then((path) => {
        setListNonce((n) => n + 1);
        select([path]);
        setEditing(path);
      })
      .catch((e) => console.error(e));
  };

  /** Adds the links in `text` to this folder's queue, after asking unless the user chose not to be asked. */
  const pasteLinks = (text: string) => {
    const urls = linksIn(text);
    if (!urls.length) return;
    if (pasteMode === "always") {
      addLinks(urls).catch((e) => setNotice(`Couldn't add: ${e}`));
    } else {
      setAdding(false);
      setPasting(urls);
    }
  };

  // Links sent from the browser extension wait at the bottom, with any captured
  // before them, until the user adds them to a folder or dismisses them.
  useEffect(() => {
    const unlisten = onBrowserLinks((urls) =>
      setCaptured((prev) => [...new Set([...(prev ?? []), ...linksIn(urls.join("\n"))])]),
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Command-V pastes cut or copied items into this folder while the clipboard
  // still holds them, and otherwise adds the links on it.
  const paste = () => {
    if (!cwd) return;
    engine
      .readClipboard()
      .then((text) => {
        if (clip && (clipText.current === null || text === clipText.current)) pasteItems(cwd);
        else if (text !== clipText.current) pasteLinks(text);
      })
      .catch(() => {
        if (clip && clipText.current === null) pasteItems(cwd);
      });
  };

  // Command-X and Command-C cut and copy the selection, for pasting elsewhere;
  // Command-N makes a new folder with its own queue; Command-[ and Command-]
  // go back and forward; Command-. shows or hides folders without downloads;
  // Command-1 and Command-2 switch to icons and list; Command-O shows or hides the overview;
  // Command-Delete moves the selection to the Trash; Delete/Backspace alone
  // removes the selected downloads from the list (finished files stay);
  // Command-A selects everything in the folder; Command-Down opens the selected
  // item and Command-Up goes to the enclosing folder (Control-A and Alt-arrows elsewhere);
  // Return renames the selected folder, as in Finder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || menu) return;
      const command = IS_MAC ? e.metaKey : e.ctrlKey;
      const arrow = e.key.startsWith("Arrow");
      if (arrow && (IS_MAC ? e.metaKey : e.altKey)) {
        e.preventDefault();
        if (e.key === "ArrowUp") goUp();
        if (e.key === "ArrowDown" && selection.length === 1) {
          const [key] = selection;
          const file = files.find((f) => f.id === key);
          if (file) onOpenFile(file);
          else go(key);
        }
      } else if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        moveSelection(e.key, e.shiftKey);
      } else if ((e.key === "Delete" || e.key === "Backspace") && command) {
        trashItems(selection);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const ids = selectedFiles.map((f) => f.id);
        if (!ids.length) return;
        ids.forEach((id) => report(engine.remove(id)));
        select([]);
      } else if (e.key.toLowerCase() === "v" && command) {
        e.preventDefault();
        paste();
      } else if ((e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") && command && selection.length) {
        e.preventDefault();
        clipItems(selection, e.key.toLowerCase() === "x");
      } else if ((e.key === "[" || e.key === "]") && command) {
        e.preventDefault();
        if (e.key === "[") goBack();
        else goForward();
      } else if (e.key.toLowerCase() === "i" && command) {
        e.preventDefault();
        toggleDetails();
      } else if (e.key.toLowerCase() === "o" && command) {
        e.preventDefault();
        setOverviewPanel(overviewOpen ? "closed" : "open");
      } else if ((e.key === "1" || e.key === "2") && command) {
        e.preventDefault();
        setMode(e.key === "1" ? "Icons" : "List");
      } else if (e.key === "." && command) {
        e.preventDefault();
        toggleFolders();
      } else if (e.key.toLowerCase() === "n" && command) {
        e.preventDefault();
        newQueue();
      } else if ((e.key.toLowerCase() === "f" || e.key.toLowerCase() === "l") && command) {
        e.preventDefault();
        setAddressOpen(true);
      } else if (
        e.key === "Enter" &&
        !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) &&
        // A focused button, such as a prompt's, takes Return itself.
        !(e.target instanceof HTMLButtonElement) &&
        selection.length === 1 &&
        isFolderKey(selection[0])
      ) {
        e.preventDefault();
        setEditing(selection[0]);
      } else if (e.key === "Escape" && confirmPause) {
        setConfirmPause(null);
      } else if (e.key === "Escape" && duplicates) {
        settleDuplicates(duplicates.items, "skip");
      } else if (e.key === "Escape" && captured) {
        setCaptured(null);
      } else if (e.key === "Escape" && pasting) {
        setPasting(null);
      } else if (e.key === "Escape" && query) {
        setQuery("");
      } else if (e.key === "Escape" && clip?.cut) {
        setClip(null);
      } else if (e.key.toLowerCase() === "z" && command && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === "a" && command) {
        e.preventDefault();
        setSelected(new Set(order));
        setAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Only getit's own menus; text fields keep the system one for copy and paste.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!home || !cwd) return <div className="app" data-theme={theme} />;

  const own = stats(state, shown ?? cwd, false);
  const summary = [
    queue?.settings.paused && "Paused",
    own.active && `${own.active} downloading`,
    own.queued && `${own.queued} waiting`,
    own.done && `${own.done} done`,
    own.active && formatSpeed(own.speed),
  ]
    .filter(Boolean)
    .join(" · ");

  const rename = async (path: string, name: string) => {
    const renamed = await engine.renameFolder(path, name);
    setEditing(null);
    select([renamed]);
    setListNonce((n) => n + 1);
  };

  const clipMenu = (keys: string[]): MenuItem[] => [
    { kind: "action", label: "Cut", shortcut: `${MOD}X`, onSelect: () => clipItems(keys, true) },
    { kind: "action", label: "Copy", shortcut: `${MOD}C`, onSelect: () => clipItems(keys, false) },
  ];
  const pasteLabel = clip ? `Paste ${plural(clip.keys.length, "item")}` : "Paste";

  /** A queue's downloads paused one by one. */
  const heldIn = (target: QueueInfo) => target.downloads.filter((id) => state.downloads[id]?.status === "paused");
  // The toolbar shows the queue running while any of its downloads runs,
  // whether the queue or the user started it, and pausing there stops them all.
  const queueStopped = !!queue && own.active === 0;
  // Menus show a queue's own state: paused, or stopped by pausing its
  // downloads one by one; downloads started on their own don't count.
  const isQueuePaused = (target: QueueInfo) => {
    const st = stats(state, target.dir, false);
    return target.settings.paused || (st.active === 0 && st.queued === 0 && heldIn(target).length > 0);
  };
  const queuePaused = !!queue && isQueuePaused(queue);
  // Pausing or resuming means nothing for a queue with nothing left to download.
  const hasWork = (target: QueueInfo) => stats(state, target.dir, false).pending > 0;
  // Unpauses a queue and puts downloads paused one by one back in line.
  const resumeQueueOf = (target: QueueInfo) => {
    const { settings } = target;
    const held = heldIn(target);
    report(
      (async () => {
        if (settings.paused) await engine.setQueueSettings(target.id, { ...settings, paused: false });
        if (held.length) await engine.requeue(held);
      })(),
    );
  };
  const resumeQueue = () => queue && resumeQueueOf(queue);
  // Stops everything in a queue. Pausing a running queue stops all its
  // downloads; in one that's paused already, only downloads started on their
  // own run, so they're paused one by one.
  const pauseQueueOf = (target: QueueInfo) => {
    const { settings } = target;
    if (!settings.paused) return report(engine.setQueueSettings(target.id, { ...settings, paused: true }));
    const running = target.downloads.filter((id) => state.downloads[id]?.status === "downloading");
    report(Promise.all(running.map((id) => engine.pause(id))));
  };
  const pauseQueue = () => queue && pauseQueueOf(queue);
  /** Stops every queue that has something running. */
  const pauseAll = () => {
    for (const q of Object.values(state.queues)) {
      if (q.downloads.some((id) => state.downloads[id]?.status === "downloading")) pauseQueueOf(q);
    }
  };
  const toggleQueue = () => (queueStopped ? resumeQueue() : pauseQueue());

  const backgroundMenu = (): MenuItem[] => {
    const items: MenuItem[] = [];
    if (queue) items.push({ kind: "header", label: summary ? `Queue · ${summary}` : "Queue" });
    if (lastUndo) {
      items.push(
        { kind: "action", label: `Undo ${lastUndo.label}`, shortcut: `${MOD}Z`, onSelect: undo },
        { kind: "separator" },
      );
    }
    items.push(
      { kind: "action", label: "Add download…", onSelect: () => setAdding(true) },
      ...(clip
        ? [{ kind: "action", label: pasteLabel, shortcut: `${MOD}V`, onSelect: () => pasteItems(cwd) } as const]
        : []),
      {
        kind: "action",
        label: "Paste link",
        onSelect: () => engine.readClipboard().then(pasteLinks).catch(() => {}),
      },
      { kind: "action", label: "New queue", shortcut: `${MOD}N`, onSelect: newQueue },
      { kind: "action", label: `Open in ${FILE_MANAGER}`, onSelect: () => report(engine.openPath(cwd)) },
      {
        kind: "action",
        label: "Ask before adding pasted links",
        checked: pasteMode === "ask",
        onSelect: () => setPasteMode(pasteMode === "ask" ? "always" : "ask"),
      },
    );
    if (queue) {
      const { settings } = queue;
      items.push(
        { kind: "separator" },
        {
          kind: "action",
          label: queuePaused ? "Resume queue" : "Pause queue",
          disabled: !hasWork(queue),
          onSelect: queuePaused ? resumeQueue : pauseQueue,
        },
        {
          kind: "stepper",
          label: "Downloads at a time",
          value: settings.max_concurrent,
          min: 1,
          max: MAX_CONCURRENCY,
          onChange: (n) => report(engine.setQueueSettings(queue.id, { ...settings, max_concurrent: n })),
        },
        {
          kind: "action",
          label: "Clear done",
          disabled: own.done === 0,
          onSelect: () => report(engine.clearCompleted(queue.id)),
        },
      );
    }
    return items;
  };

  const downloadMenu = (vm: FileVm): MenuItem[] => {
    const status = state.downloads[vm.id]?.status;
    const items: MenuItem[] = [];
    if (vm.done) {
      items.push({
        kind: "action",
        label: "Open",
        disabled: vm.missing || !vm.path,
        onSelect: () => onOpenFile(vm),
      });
    } else {
      if (status === "downloading" || status === "queued") {
        if (vm.action === "resume") {
          // Waiting in a paused queue: start it on its own.
          items.push({ kind: "action", label: "Resume", onSelect: () => report(engine.resume(vm.id)) });
        }
        items.push({ kind: "action", label: "Pause", onSelect: () => pauseDownloads([vm.id]) });
      } else {
        items.push({
          kind: "action",
          label: status === "failed" ? "Retry" : "Resume",
          onSelect: () => report(engine.resume(vm.id)),
        });
      }
    }
    if (query) items.push(showInFolderItem(vm.id));
    items.push(revealItem([vm.id]));
    items.push({ kind: "separator" }, ...clipMenu([vm.id]), { kind: "separator" });
    if (vm.done) {
      // The file stays on disk.
      items.push({
        kind: "action",
        label: "Remove from list",
        onSelect: () => {
          report(engine.remove(vm.id));
          select([]);
        },
      });
    }
    items.push({ kind: "action", label: "Move to Trash", danger: true, onSelect: () => trashItems([vm.id]) });
    return items;
  };

  const selectionMenu = (): MenuItem[] => {
    const items: MenuItem[] = [{ kind: "header", label: `${plural(selection.length, "item")} selected` }];
    const trash: MenuItem = {
      kind: "action",
      label: `Move ${plural(selection.length, "item")} to Trash`,
      danger: true,
      onSelect: () => trashItems(selection),
    };
    items.push(revealItem(selection), { kind: "separator" }, ...clipMenu(selection), { kind: "separator" });
    if (!selectedFiles.length) return [...items, trash];
    const status = (f: FileVm) => state.downloads[f.id]?.status;
    const queuePaused = (f: FileVm) => state.queues[state.downloads[f.id]?.queue_id]?.settings.paused ?? false;
    const pausable = selectedFiles.filter((f) => status(f) === "downloading" || status(f) === "queued");
    // Downloads waiting in a paused queue can be started on their own too.
    const resumable = selectedFiles.filter(
      (f) => status(f) === "paused" || status(f) === "failed" || (status(f) === "queued" && queuePaused(f)),
    );
    const done = selectedFiles.filter((f) => f.done);
    items.push(
      {
        kind: "action",
        label: "Pause",
        disabled: !pausable.length,
        onSelect: () => pauseDownloads(pausable.map((f) => f.id)),
      },
      {
        kind: "action",
        label: "Resume",
        disabled: !resumable.length,
        // Back in line, so the queue's limit holds; a paused queue gets them started on their own.
        onSelect: () => {
          resumable.filter(queuePaused).forEach((f) => report(engine.resume(f.id)));
          const requeued = resumable.filter((f) => !queuePaused(f)).map((f) => f.id);
          if (requeued.length) report(engine.requeue(requeued));
        },
      },
      { kind: "separator" },
    );
    if (done.length) {
      // The files stay on disk.
      items.push({
        kind: "action",
        label: `Remove ${plural(done.length, "finished download")} from list`,
        onSelect: () => {
          done.forEach((f) => report(engine.remove(f.id)));
          select([]);
        },
      });
    }
    items.push(trash);
    return items;
  };

  const menuItems = (target: string | null): MenuItem[] => {
    if (target === null) return backgroundMenu();
    if (selection.length > 1 && selected.has(target)) return selectionMenu();
    const file = files.find((f) => f.id === target);
    if (file) return downloadMenu(file);
    if (folders.some((g) => g.path === target)) {
      const folderQueue = queueForDir(state, target);
      return [
        { kind: "action", label: "Open", onSelect: () => go(target) },
        ...(folderQueue
          ? [
              isQueuePaused(folderQueue)
                ? ({
                    kind: "action",
                    label: "Resume queue",
                    disabled: !hasWork(folderQueue),
                    onSelect: () => resumeQueueOf(folderQueue),
                  } as const)
                : ({
                    kind: "action",
                    label: "Pause queue",
                    disabled: !hasWork(folderQueue),
                    onSelect: () => pauseQueueOf(folderQueue),
                  } as const),
            ]
          : []),
        ...(query ? [showInFolderItem(target)] : []),
        revealItem([target]),
        { kind: "action", label: "Rename", shortcut: IS_MAC ? "↩" : "Enter", onSelect: () => setEditing(target) },
        { kind: "separator" },
        ...clipMenu([target]),
        ...(clip && !clip.keys.includes(target)
          ? [{ kind: "action", label: `${pasteLabel} Into Folder`, onSelect: () => pasteItems(target) } as const]
          : []),
        { kind: "separator" },
        { kind: "action", label: "Move to Trash", danger: true, onSelect: () => trashItems([target]) },
      ];
    }
    return [];
  };

  const global = stats(state, "/", true);
  const overview = overviewOpen ? overviewTree(state, home) : [];
  const count = folders.length + files.length;
  const single = selection.length === 1 ? selection[0] : null;
  const selFile = files.find((f) => f.id === single);
  const selFolder = folders.find((g) => g.path === single);
  const nameOf = (key: string) =>
    folders.find((g) => g.path === key)?.name ?? files.find((f) => f.id === key)?.name ?? key;
  // Temporary items for links being added here: while checked, and while the
  // user decides about the duplicates among them.
  const asked = new Set(duplicates?.items.map((d) => d.pendingKey));
  const pending = results
    ? []
    : pendingAdds
        .filter((p) => p.dir === shown && (p.name === null || asked.has(p.key)))
        .map((p) => pendingVm(p.key, p.url, p.name, p.name === null ? "Checking…" : "Already downloaded"));
  const viewProps: ItemViewProps = {
    folders,
    files,
    pending,
    selected,
    onItemMouseDown,
    onItemClick,
    onOpenFolder: (path) => go(path),
    onOpenFile,
    onAction,
    onItemMenu: (target, x, y) => {
      if (!selected.has(target)) select([target]);
      setMenu({ x, y, target });
    },
    editing,
    onRename: rename,
    onCancelRename: () => setEditing(null),
    dragging: new Set(drag?.keys),
    dropTarget: drag?.target ?? null,
    cut: new Set(clip?.cut ? clip.keys : []),
  };

  return (
    <div className="app" data-theme={theme}>
      <Toolbar
        canBack={history!.back.length > 0}
        canForward={history!.forward.length > 0}
        canUp={canUp}
        onBack={goBack}
        onForward={goForward}
        onUp={goUp}
        cwdLabel={displayPath(cwd, home)}
        crumbs={crumbsFrom(home, cwd)}
        onCrumb={(path) => go(path)}
        dropTarget={drag?.target ?? null}
        addressOpen={addressOpen}
        onAddressOpen={setAddressOpen}
        query={query}
        onQuery={setQuery}
        searchAll={searchAll}
        onSearchAll={setSearchAll}
        onGoTo={async (raw) => {
          const path = resolvePath(raw, home);
          await engine.listDir(path);
          go(path);
          setAddressOpen(false);
        }}
        onSearchResults={() => {
          if (!order.length) return;
          select([order[0]]);
          lead.current = order[0];
        }}
        mode={mode}
        onMode={setMode}
        showAllFolders={showAllFolders}
        onToggleFolders={toggleFolders}
        queueState={queue ? (!hasWork(queue) ? "empty" : queueStopped ? "stopped" : "running") : null}
        onToggleQueue={toggleQueue}
        onToggleAdd={() => {
          setPasting(null);
          setAdding((a) => !a);
        }}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "Dark" ? "Light" : "Dark")}
        overviewOpen={overviewOpen}
        activeCount={global.active}
        onToggleOverview={() => setOverviewPanel(overviewOpen ? "closed" : "open")}
      />

      {adding && (
        <InputBar
          label="Download into"
          dirLabel={displayPath(cwd, home)}
          placeholder="https://…"
          submitLabel="Add to queue"
          mono
          onSubmit={async (raw) => {
            const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
            await addLinks([url]);
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {pasting && (
        <PasteBar
          urls={pasting}
          dirLabel={displayPath(cwd, home)}
          onAdd={async (always) => {
            if (always) setPasteMode("always");
            await addLinks(pasting);
          }}
          onClose={() => setPasting(null)}
        />
      )}

      {confirmPause && (
        <PauseBar
          names={confirmPause.flatMap((id) => (state.downloads[id] ? [displayName(state.downloads[id])] : []))}
          lost={formatSize(confirmPause.reduce((sum, id) => sum + (state.downloads[id]?.downloaded ?? 0), 0))}
          // Only those still running; any that finished or stopped meanwhile are left alone.
          onPause={() => confirmPause.filter(losesProgress).forEach((id) => report(engine.pause(id)))}
          onClose={() => setConfirmPause(null)}
        />
      )}

      <div className="main">
        <div
          ref={contentRef}
          className="content"
          onMouseDown={onContentMouseDown}
          onClick={(e) => {
            if (!e.shiftKey && !(IS_MAC ? e.metaKey : e.ctrlKey)) select([]);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            select([]);
            setMenu({ x: e.clientX, y: e.clientY, target: null });
          }}
        >
          {mode === "Icons" ? <IconView {...viewProps} /> : <ListView {...viewProps} />}
          {marquee.box && <div className="marquee" style={marquee.box} />}
          {count === 0 && !pending.length && shown === cwd && state.loaded && (
            <div className="empty">
              {query
                ? `Nothing${searchAll ? "" : ` in ${displayPath(cwd, home)}`} matches “${query}”.`
                : listing.error
                  ? `Can't open this folder: ${listing.error}`
                  : hiddenFolders > 0
                    ? `No downloads here. ${plural(hiddenFolders, "folder")} without downloads ${hiddenFolders === 1 ? "is" : "are"} hidden.`
                    : "This folder is empty. Right-click to add a download or a queue."}
            </div>
          )}
        </div>
        {overviewOpen && (
          <Overview
            nodes={overview}
            onOpenQueue={(dir) => go(dir)}
            onOpenFile={(dir, id) => go(dir, id)}
            onAction={onAction}
            onPauseQueue={(id) => state.queues[id] && pauseQueueOf(state.queues[id])}
            onPauseAll={pauseAll}
            onClose={() => setOverviewPanel("closed")}
          />
        )}
      </div>

      {duplicates && (
        <DuplicatePanel
          rows={duplicates.items.map((d) => {
            const item = currentOf(d);
            return {
              key: d.url,
              name: item ? displayName(item) : d.kind === "file" ? d.name : d.url,
              ...whereLabel(item ? (state.queues[item.queue_id]?.dir ?? duplicates.dir) : duplicates.dir),
              status: item ? STATUS_WORDS[item.status] : "File",
              note: d.kind === "name" ? "same name, different link" : undefined,
              action: !item ? `Show in ${FILE_MANAGER}` : canStart(item) ? "Start existing" : "Show existing",
            };
          })}
          mainLabel={
            duplicates.items.some((d) => canStart(currentOf(d)))
              ? "Start all existing"
              : duplicates.items.some((d) => d.kind !== "file")
                ? "Show existing"
                : `Show all in ${FILE_MANAGER}`
          }
          onMain={() => settleDuplicates(duplicates.items, "start")}
          onAdd={() => settleDuplicates(duplicates.items, "add")}
          onSkip={() => settleDuplicates(duplicates.items, "skip")}
          onRowMain={(i) => settleDuplicates([duplicates.items[i]], "start")}
          onRowAdd={(i) => settleDuplicates([duplicates.items[i]], "add")}
          onRowSkip={(i) => settleDuplicates([duplicates.items[i]], "skip")}
          onWhere={(i) => showDuplicate(duplicates.dir, duplicates.items[i])}
        />
      )}

      {captured && captured.length > 0 && (
        <CapturedBar
          urls={captured}
          dirLabel={displayPath(cwd, home)}
          onAdd={() => addLinks(captured)}
          onClose={() => setCaptured(null)}
        />
      )}

      {detailsOpen && (
        <Details
          item={selFile ? (state.downloads[selFile.id] ?? null) : null}
          vm={selFile ?? null}
          speed={selFile ? (state.speeds[selFile.id] ?? 0) : 0}
          folder={selFile ? displayPath(dirOf(selFile.id) ?? cwd, home) : ""}
          selectionLabel={
            selection.length > 1
              ? `${plural(selection.length, "item")} selected. Select one download to see its details.`
              : "Select a download to see its details."
          }
          onAction={onAction}
          onCopy={(text) => report(engine.writeClipboard(text))}
          onReveal={() => {
            const path = selFile && diskPath(selFile.id);
            if (path) report(engine.reveal([path]));
          }}
        />
      )}

      <StatusBar
        itemCount={
          query
            ? plural(count, "result")
            : plural(count, "item") + (queue?.settings.paused ? " · Queue paused" : "")
        }
        selInfo={
          selFile
            ? query
              ? `${displayPath(dirOf(selFile.id) ?? cwd, home)} — ${selFile.info}`
              : selFile.info
            : selFolder
              ? `${displayPath(selFolder.path, home)}`
              : selection.length > 1
                ? `${plural(selection.length, "item")} selected — drag onto a folder to move`
                : ""
        }
        left={`${global.active} downloading · ${global.queued} waiting`}
        speed={`↓ ${formatSpeed(global.speed)}`}
        warning={state.saveError}
        notice={notice}
        detailsOpen={detailsOpen}
        onToggleDetails={toggleDetails}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.target)} onClose={closeMenu} />}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
          {drag.keys.length === 1 ? nameOf(drag.keys[0]) : plural(drag.keys.length, "item")}
        </div>
      )}
    </div>
  );
}
