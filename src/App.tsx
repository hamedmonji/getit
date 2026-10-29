import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Details } from "./components/Details";
import { NoAccess } from "./components/NoAccess";
import { Onboarding } from "./components/Onboarding";
import { Overview } from "./components/Overview";
import { QueueSettings } from "./components/QueueSettings";
import { RefreshLink } from "./components/RefreshLink";
import { Settings } from "./components/Settings";
import {
  CapturedBar,
  DuplicatePanel,
  InputBar,
  PasteBar,
  PauseBar,
  StatusBar,
  Toolbar,
  UpdateBar,
  type SearchKind,
} from "./components/Bars";
import { ContextMenuItems } from "./components/ContextMenu";
import { IconView, ListView, type ItemViewProps } from "./components/ItemViews";
import { canStart, useAddLinks } from "./hooks/useAddLinks";
import { useClipboardItems } from "./hooks/useClipboardItems";
import { useDirListing } from "./hooks/useDirListing";
import { useDockProgress } from "./hooks/useDockProgress";
import { useEngine } from "./hooks/useEngine";
import { useItemDrag } from "./hooks/useItemDrag";
import { useMarquee } from "./hooks/useMarquee";
import { useShortcuts } from "./hooks/useShortcuts";
import { useSortOrder } from "./hooks/useSortOrder";
import { useStoredState } from "./hooks/useStoredState";
import { useSystemDark } from "./hooks/useSystemDark";
import { useUndo } from "./hooks/useUndo";
import { useUpdate } from "./hooks/useUpdate";
import {
  accentTokens,
  DENSITIES,
  isAccent,
  resolveTheme,
  THEME_PREFERENCES,
  type Accent,
  type Density,
  type ThemePreference,
} from "./lib/appearance";
import { engine, onBrowserLinks, type Captured, type DownloadStatus } from "./lib/engine";
import { formatSize, formatSpeed, plural } from "./lib/format";
import { isFolderKey, splitKeys } from "./lib/keys";
import { linksIn, takeForRefresh, withCaptured, withoutCaptured } from "./lib/links";
import { bestQueueFor } from "./lib/match";
import type { MenuContext } from "./lib/menus";
import { baseName, canGoUp, crumbsFrom, displayPath, joinPath, parentPath, resolvePath } from "./lib/paths";
import { FILE_MANAGER, IS_MAC } from "./lib/platform";
import { accessTop, addFolder } from "./lib/access";
import { hasWork, pauseAll, pauseQueue, resumeQueue } from "./lib/queueControl";
import { report } from "./lib/report";
import { sortFiles } from "./lib/sort";
import { isTyping, matchByName, typeAhead, type Typed } from "./lib/typeSelect";
import {
  displayName,
  fileVm,
  folderVm,
  nameFromUrl,
  overviewList,
  pendingVm,
  queueForDir,
  searchResults,
  stats,
  type FileVm,
  type FolderVm,
  type OverviewShow,
  type ViewMode,
} from "./lib/viewModels";

/** What listing a folder fails with when the system won't let getit read it. */
const NO_ACCESS = "no access";

const STATUS_WORDS: Record<DownloadStatus, string> = {
  queued: "Waiting",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Finished",
  failed: "Failed",
};

interface History {
  cwd: string;
  back: string[];
  forward: string[];
}

/** How often onboarding checks whether Full Disk Access is on. */
const FULL_DISK_POLL_MS = 1500;
/** How long a failed move's message stays in the status bar. */
const NOTICE_MS = 6000;

export default function App() {
  const state = useEngine();
  useDockProgress(state);
  const [home, setHome] = useState<string | null>(null);
  /** The folder chosen on first launch as the top, instead of home; null when none was. */
  const [root, setRoot] = useState<string | null>(null);
  /** More folders getit may open, added in Settings. */
  const [accessFolders, setAccessFolders] = useState<string[]>([]);
  /** Whether getit has Full Disk Access, as last checked. */
  const [fullDisk, setFullDisk] = useState(false);
  /** Whether to ask how getit gets into macOS's protected folders, on first launch. */
  const [firstLaunch, setFirstLaunch] = useState(false);
  // Remembered so onboarding resumes at step 2 when macOS restarts getit to
  // apply Full Disk Access.
  const [onboardingStep, setOnboardingStep] = useStoredState("getit.onboardingStep", ["1", "2"] as const, () => "1");
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
  /** The download being given a new link, if one is. */
  const [refreshing, setRefreshing] = useState<string | null>(null);
  /** A link the browser captured while a download was waiting for a new one. */
  const [refreshCapture, setRefreshCapture] = useState<string | null>(null);
  /** Bumped to re-list the folder after changes the engine doesn't report. */
  const [listNonce, setListNonce] = useState(0);
  const refresh = useCallback(() => setListNonce((n) => n + 1), []);
  /** Whether the user went to turn on Full Disk Access, which may need a restart to apply. */
  const [accessAsked, setAccessAsked] = useState(false);
  /** getit's app bundle, to drag into the Full Disk Access list; null in development. */
  const [appBundle, setAppBundle] = useState<string | null>(null);
  useEffect(() => {
    engine.appBundle().then(setAppBundle, () => {});
  }, []);
  /**
   * What the right-click menu is for: a folder path or download id, or null for
   * the folder's empty space. Counts the times it opened, to make a new one each time.
   */
  const [menu, setMenu] = useState<{ target: string | null; opened: number }>({ target: null, opened: 0 });
  const [themePref, setThemePref] = useStoredState<ThemePreference>("getit.theme", THEME_PREFERENCES, () => "System");
  const theme = resolveTheme(themePref, useSystemDark());
  const [accent, setAccent] = useStoredState<Accent>("getit.accent", isAccent, () => "blue");
  const [density, setDensity] = useStoredState<Density>("getit.density", DENSITIES, () => "comfortable");
  // On the document rather than the app: menus and dialogs show outside it, and
  // shadcn's components take dark mode from a `dark` class above them.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.classList.toggle("dark", theme === "Dark");
    for (const [name, value] of Object.entries(accentTokens(accent, theme))) root.style.setProperty(name, value);
  }, [theme, accent, density]);
  const [mode, setMode] = useStoredState<ViewMode>("getit.view", ["Icons", "List"], () => "Icons");
  const [folderFilter, setFolderFilter] = useStoredState<"all" | "queues">(
    "getit.folders",
    ["all", "queues"],
    () => "queues",
  );
  const showAllFolders = folderFilter === "all";
  const toggleFolders = () => setFolderFilter(showAllFolders ? "queues" : "all");
  const [overviewPanel, setOverviewPanel] = useStoredState<"open" | "closed">(
    "getit.overview",
    ["open", "closed"],
    () => "closed",
  );
  /**
   * The queue settings panel, for the selected queue folder's queue or else this
   * folder's. It takes the overview's place while open; closing it brings it back.
   */
  const [queuePanel, setQueuePanel] = useStoredState<"open" | "closed">(
    "getit.queuePanel",
    ["open", "closed"],
    () => "closed",
  );
  const queuePanelOpen = queuePanel === "open";
  const toggleQueuePanel = () => setQueuePanel(queuePanelOpen ? "closed" : "open");
  const overviewOpen = overviewPanel === "open" && !queuePanelOpen;
  /** Whether the overview lists only running downloads or all of them. */
  const [overviewShow, setOverviewShow] = useStoredState<OverviewShow>(
    "getit.overviewShow",
    ["active", "all"],
    () => "active",
  );
  const toggleOverview = () => {
    setQueuePanel("closed");
    setOverviewPanel(overviewOpen ? "closed" : "open");
  };
  /** Whether the settings popup is showing. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = () => setSettingsOpen((open) => !open);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  /** Global sort order for files: by the first key, then the next for ties. */
  const [sortOrder, setSortOrder] = useSortOrder();
  const [detailsPanel, setDetailsPanel] = useStoredState<"open" | "closed">(
    "getit.details",
    ["open", "closed"],
    () => "closed",
  );
  const detailsOpen = detailsPanel === "open";
  const toggleDetails = () => setDetailsPanel(detailsOpen ? "closed" : "open");
  /** Whether pasting links asks first or adds them right away. */
  const [pasteMode, setPasteMode] = useStoredState<"ask" | "always">("getit.paste", ["ask", "always"], () => "ask");
  /** Links the browser extension captured, waiting to be added to a folder. */
  const [captured, setCaptured] = useState<string[] | null>(null);
  /** Links from the clipboard waiting for the user to confirm. */
  const [pasting, setPasting] = useState<string[] | null>(null);
  /** Downloads waiting for the user to confirm pausing, since they can't resume. */
  const [confirmPause, setConfirmPause] = useState<string[] | null>(null);
  /** Pastes, trashes and renames that can be undone. */
  const { push: pushUndo, undo } = useUndo(setNotice, refresh);
  const updater = useUpdate();
  /** Whether the address bar is being typed in. */
  const [addressOpen, setAddressOpen] = useState(false);
  /** The search shown in place of the folder's contents; empty when browsing. */
  const [query, setQuery] = useState("");
  /** Whether the search covers every queue rather than this folder. */
  const [searchAll, setSearchAll] = useState(false);
  /** Whether the search shows only folders or only files; empty shows both. */
  const [searchKinds, setSearchKinds] = useState<SearchKind[]>([]);
  useEffect(() => {
    if (!addressOpen && !query) {
      setSearchAll(false);
      setSearchKinds([]);
    }
  }, [addressOpen, query]);

  useEffect(() => {
    Promise.all([engine.homeDir(), engine.initialDir(), engine.accessSetup()]).then(([home, start, setup]) => {
      setHome(home);
      setRoot(setup?.root ?? null);
      setAccessFolders(setup?.folders ?? []);
      setFirstLaunch(IS_MAC && !setup);
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
  const { duplicates, pendingAdds, addLinks, checkCaptured, settleDuplicates, currentOf, showDuplicate } = useAddLinks({
    state,
    cwd: history?.cwd ?? null,
    select,
    go,
    setNotice,
    recapture: (urls) => setCaptured((prev) => withCaptured(prev, urls)),
  });

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
  /** Where Up stops: home, or the chosen folders' common folder without Full Disk Access. */
  const top = home ? accessTop(home, root, accessFolders, fullDisk) : null;
  const canUp = !!home && !!cwd && canGoUp(cwd, home, top ?? home);
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
  /** Whether the search results include this kind; browsing shows everything. */
  const showsKind = (kind: SearchKind) => !results || !searchKinds.length || searchKinds.includes(kind);
  const folders = showsKind("folders") ? shownFolders(results?.folders ?? allFolders) : [];
  const unsortedFiles = showsKind("files") ? (results?.files ?? folderFiles) : null;
  const files = useMemo(() => (unsortedFiles ? sortFiles(unsortedFiles, sortOrder) : []), [unsortedFiles, sortOrder]);

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
      const { ids, paths } = splitKeys(keys);
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
    scrollToItem(target);
  };
  const scrollToItem = (key: string) =>
    contentRef.current?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });

  /** What the user has typed to select an item by name, like Finder. */
  const typed = useRef<Typed | null>(null);
  const typeSelect = (char: string) => {
    typed.current = typeAhead(typed.current, char, Date.now());
    const items = [
      ...folders.map((g) => ({ key: g.path, name: g.name })),
      ...files.map((f) => ({ key: f.id, name: f.name })),
    ];
    const key = matchByName(items, typed.current.text);
    if (key === null) return;
    select([key]);
    lead.current = key;
    scrollToItem(key);
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

  /** A duplicate's folder as shown in the panel: "This Queue" for the folder on screen. */
  const whereLabel = (dir: string) =>
    dir === cwd ? { where: "This Queue", here: true } : { where: displayPath(dir, home ?? "") };

  /** The folder a download's file goes in. */
  const dirOf = (id: string) => state.queues[state.downloads[id]?.queue_id]?.dir;
  /** Goes to the folder holding a search result, with the result selected. */
  const showInFolder = (key: string) => {
    const dir = key in state.downloads ? dirOf(key) : parentPath(key);
    if (dir) go(dir, key);
  };
  // Unfinished downloads have no file yet, so their folder stands in for them.
  const diskPath = (key: string) => {
    if (isFolderKey(key)) return key;
    const vm = files.find((f) => f.id === key);
    return vm?.done && !vm.missing && vm.path ? vm.path : dirOf(key);
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
  // Like Finder's New Folder with Selection: the items move into a new queue
  // folder here, whose name is then edited in place.
  const newQueueWith = (keys: string[]) => {
    if (!cwd || !keys.length) return;
    const { ids, paths } = splitKeys(keys);
    engine
      .createQueue(cwd)
      .then(async (path) => {
        const results = await Promise.allSettled([
          ids.length ? engine.moveDownloads(ids, path) : null,
          paths.length ? engine.moveFolders(paths, path) : null,
        ]);
        const failed = results.find((r) => r.status === "rejected");
        setNotice(failed ? `Couldn't move: ${failed.reason}` : null);
        setListNonce((n) => n + 1);
        select([path]);
        setEditing(path);
      })
      .catch((e) => setNotice(`Couldn't create the queue: ${e}`));
  };

  // macOS doesn't list apps under Full Disk Access on its own, so getit is
  // shown in Finder too, to drag into the list.
  const revealAppBundle = appBundle ? () => report(engine.reveal([appBundle])) : null;
  const askFullDiskAccess = () => {
    setAccessAsked(true);
    revealAppBundle?.();
    report(engine.openFullDiskAccessSettings());
  };

  // Onboarding's one folder: the chosen folder becomes the top and is opened,
  // and getit may read it even inside a protected folder, since the user chose it.
  const chooseRoot = () => {
    engine
      .chooseFolder(home ?? "/", "Choose a folder for getit")
      .then(async (picked) => {
        if (!picked) return;
        await engine.setAccessSetup(picked);
        setRoot(picked);
        setFirstLaunch(false);
        setHistory({ cwd: picked, back: [], forward: [] });
      })
      .catch((e) => setNotice(`Couldn't choose the folder: ${e}`));
  };

  // Settings' added folders: getit may open each, even inside a protected folder,
  // since the user chose it.
  const saveAccessFolders = (folders: string[]) =>
    engine
      .setAccessFolders(folders)
      .then(() => {
        setAccessFolders(folders);
        setListNonce((n) => n + 1);
      })
      .catch((e) => setNotice(`Couldn't save the folders: ${e}`));
  const addAccessFolder = () => {
    engine
      .chooseFolder(cwd ?? home ?? "/", "Choose a folder getit can open")
      .then((picked) => {
        if (!picked) return;
        const next = addFolder(accessFolders, root, picked);
        if (next !== accessFolders) return saveAccessFolders(next);
      })
      .catch((e) => setNotice(`Couldn't choose the folder: ${e}`));
  };
  const removeAccessFolder = (path: string) => saveAccessFolders(accessFolders.filter((f) => f !== path));

  // Checks Full Disk Access on launch, and again while the settings are open,
  // where the user may be turning it on; the folder is listed again when it changes.
  useEffect(() => {
    if (!IS_MAC) return;
    const check = () => engine.fullDiskAccess().then(setFullDisk, (e) => console.error(e));
    check();
    if (!settingsOpen) return;
    const timer = setInterval(check, FULL_DISK_POLL_MS);
    return () => clearInterval(timer);
  }, [settingsOpen]);
  useEffect(() => setListNonce((n) => n + 1), [fullDisk]);

  // Development only: shows onboarding again from step 1, after a restart.
  const resetOnboarding = () => {
    setOnboardingStep("1");
    engine
      .resetAccessSetup()
      .then(() => engine.relaunch())
      .catch((e) => setNotice(`Couldn't reset onboarding: ${e}`));
  };

  // While onboarding asks where getit can save, it goes on by itself once Full
  // Disk Access is on, whether the user turned it on just now or before a restart.
  useEffect(() => {
    if (!firstLaunch || onboardingStep !== "2") return;
    let done = false;
    const check = () =>
      engine.fullDiskAccess().then((granted) => {
        if (!granted || done) return;
        done = true;
        engine
          .setAccessSetup(null)
          .then(() => {
            setFirstLaunch(false);
            setListNonce((n) => n + 1);
          })
          .catch((e) => setNotice(`Couldn't save the choice: ${e}`));
      }, (e) => console.error(e));
    check();
    const timer = setInterval(check, FULL_DISK_POLL_MS);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [firstLaunch, onboardingStep]);

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

  const { clip, setClip, clipItems, pasteItems, paste } = useClipboardItems({
    state,
    files,
    cwd,
    select,
    setNotice,
    refresh,
    pushUndo,
    pasteLinks,
  });

  // Links sent from the browser extension wait at the bottom, with any captured
  // before them, until the user adds them to a folder or dismisses them. getit
  // goes to the queue whose name best matches the first link's file name and
  // page title; when none does, it opens the search to find a folder. Links
  // that are already downloads are asked about right away instead; same-name
  // ones leave the bottom once the server has given their names.
  const onCaptured = useRef<(captured: Captured) => void>(() => {});
  onCaptured.current = ({ urls, title }) => {
    let links = linksIn(urls.join("\n"));
    // A download waiting for a new link takes the first one.
    if (refreshing) {
      const { refresh, rest } = takeForRefresh(links);
      if (refresh) setRefreshCapture(refresh);
      links = rest;
    }
    if (!links.length || !cwd) return;
    const match = bestQueueFor(`${nameFromUrl(links[0]).replace(/\.[^.]*$/, "")} ${title ?? ""}`, Object.values(state.queues));
    const { fresh, byName } = checkCaptured(links, match?.dir ?? cwd);
    byName.then((asked) => asked.length && setCaptured((prev) => withoutCaptured(prev, asked)));
    if (!fresh.length) return;
    setCaptured((prev) => withCaptured(prev, fresh));
    if (!match) setAddressOpen(true);
    else if (match.dir !== cwd) go(match.dir);
  };
  // Links are checked against the downloads and placed from the current
  // folder, so they're taken once both have loaded; until then the app keeps
  // them.
  const linksReady = state.loaded && !!cwd;
  useEffect(() => {
    if (!linksReady) return;
    const unlisten = onBrowserLinks((captured) => onCaptured.current(captured));
    unlisten
      .then(() => engine.takeBrowserLinks())
      .then((pending) => pending.forEach((captured) => onCaptured.current(captured)));
    return () => {
      unlisten.then((f) => f());
    };
  }, [linksReady]);

  useShortcuts(
    { settingsOpen, selectionCount: selection.length, typing: () => isTyping(typed.current, Date.now()) },
    {
      closeSettings: () => setSettingsOpen(false),
      goUp,
      openSelected: () => {
        const [key] = selection;
        const file = files.find((f) => f.id === key);
        if (file) onOpenFile(file);
        else go(key);
      },
      moveSelection: (e) => moveSelection(e.key, e.shiftKey),
      trash: () => trashItems(selection),
      remove: () => {
        const ids = selectedFiles.map((f) => f.id);
        if (!ids.length) return;
        ids.forEach((id) => report(engine.remove(id)));
        select([]);
      },
      paste,
      cut: () => clipItems(selection, true),
      copy: () => clipItems(selection, false),
      back: goBack,
      forward: goForward,
      details: toggleDetails,
      overview: toggleOverview,
      settings: toggleSettings,
      queuePanel: toggleQueuePanel,
      icons: () => setMode("Icons"),
      list: () => setMode("List"),
      toggleFolders,
      newQueue,
      search: () => setAddressOpen(true),
      rename: () => setEditing(selection[0]),
      escape: () => {
        if (confirmPause) setConfirmPause(null);
        else if (duplicates) settleDuplicates(duplicates.items, "skip");
        else if (captured) setCaptured(null);
        else if (pasting) setPasting(null);
        else if (query) setQuery("");
        else if (clip?.cut) setClip(null);
      },
      undo,
      selectAll: () => {
        setSelected(new Set(order));
        setAnchor(null);
      },
      typeSelect: (e) => typeSelect(e.key),
    },
  );

  // Only getit's own menus; text fields keep the system one for copy and paste.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!home || !cwd) return <div className="app" />;

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

  const rename = async (key: string, name: string) => {
    if (!isFolderKey(key)) {
      const item = state.downloads[key];
      const old = item && displayName(item);
      await engine.renameDownload(key, name);
      setEditing(null);
      if (old) pushUndo({ label: "Rename", run: () => engine.renameDownload(key, old) });
      return;
    }
    const renamed = await engine.renameFolder(key, name);
    setEditing(null);
    select([renamed]);
    setListNonce((n) => n + 1);
  };

  // The toolbar shows the queue running while any of its downloads runs,
  // whether the queue or the user started it, and pausing there stops them all.
  const queueStopped = !!queue && own.active === 0;
  const toggleQueue = () => queue && report(queueStopped ? resumeQueue(state, queue) : pauseQueue(state, queue));

  const menuContext: MenuContext = {
    state,
    cwd,
    queue,
    summary,
    doneHere: own.done,
    clip,
    query,
    selection,
    selected,
    folders,
    files,
    selectedFiles,
    select,
    go: (path) => go(path),
    startAdding: () => setAdding(true),
    pasteItems,
    pasteLinks,
    newQueue,
    newQueueWith,
    openQueuePanel: () => setQueuePanel("open"),
    onOpenFile,
    pauseDownloads,
    refreshLink: setRefreshing,
    showInFolder,
    diskPath,
    clipItems,
    trashItems,
    setEditing,
  };

  const global = stats(state, "/", true);
  const overview = overviewOpen ? overviewList(state, home, overviewShow) : [];
  // A selected folder with a queue, else the folder you're in.
  // From what's selected, not `selection`, which only holds items in the listing
  // shown and so drops the folder you came up from until the parent's listing arrives.
  const [selectedKey] = selected.size === 1 ? [...selected] : [];
  const selectedQueue = selectedKey && isFolderKey(selectedKey) ? queueForDir(state, selectedKey) : undefined;
  // The folder you're in, not the listing shown (`queue`), which lags behind
  // until the new folder's listing arrives and would flash the previous queue.
  const settingsQueue = queuePanelOpen ? (selectedQueue ?? queueForDir(state, cwd)) : undefined;
  // Unfinished downloads in queue order, which is the order they run in. Not a
  // hook: this is past the early return above, so a hook here would break the
  // order React expects.
  const settingsQueueItems = settingsQueue
    ? settingsQueue.downloads.map((id) => state.downloads[id]).filter((item) => item && item.status !== "completed")
    : [];
  const settingsQueueFiles = settingsQueue
    ? settingsQueueItems.map((item) => fileVm(item, settingsQueue, state, "List", null))
    : [];
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
  const isEmpty = count === 0 && !pending.length && shown === cwd && state.loaded;
  const noAccess = !query && listing.error === NO_ACCESS;
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
    editing,
    onRename: rename,
    onCancelRename: () => setEditing(null),
    dragging: new Set(drag?.keys),
    dropTarget: drag?.target ?? null,
    cut: new Set(clip?.cut ? clip.keys : []),
  };

  if (firstLaunch) {
    return (
      <Onboarding
        step={onboardingStep === "2" ? 2 : 1}
        onStep={(step) => setOnboardingStep(step === 2 ? "2" : "1")}
        home={home ? baseName(home) : "Home"}
        asked={accessAsked}
        onFullDiskAccess={askFullDiskAccess}
        onChooseFolder={chooseRoot}
        error={notice}
      />
    );
  }

  return (
    <div className="app">
      <Toolbar
        canBack={history!.back.length > 0}
        canForward={history!.forward.length > 0}
        canUp={canUp}
        onBack={goBack}
        onForward={goForward}
        onUp={goUp}
        cwdLabel={displayPath(cwd, home)}
        crumbs={crumbsFrom(home, cwd, top ?? home)}
        onCrumb={(path) => go(path)}
        dropTarget={drag?.target ?? null}
        addressOpen={addressOpen}
        onAddressOpen={setAddressOpen}
        query={query}
        onQuery={setQuery}
        searchAll={searchAll}
        searchKinds={searchKinds}
        onSearchKinds={setSearchKinds}
        onSearchAll={setSearchAll}
        onGoTo={async (raw) => {
          const path = resolvePath(raw, home);
          // A folder getit can't open is still gone to, to offer granting access.
          await engine.listDir(path).catch((e) => {
            if (e !== NO_ACCESS) throw e;
          });
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
        queueState={queue ? (!hasWork(state, queue) ? "empty" : queueStopped ? "stopped" : "running") : null}
        onToggleQueue={toggleQueue}
        onToggleAdd={() => {
          setPasting(null);
          setAdding((a) => !a);
        }}
        theme={theme}
        onToggleTheme={() => setThemePref(theme === "Dark" ? "Light" : "Dark")}
        overviewOpen={overviewOpen}
        activeCount={global.active}
        onToggleOverview={toggleOverview}
        onToggleSettings={toggleSettings}
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

      {updater.update && (
        <UpdateBar
          version={updater.update.version}
          phase={updater.phase}
          onInstall={() => void updater.install()}
          onRestart={() => report(updater.restart())}
          onClose={updater.dismiss}
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
        {/* Not modal, so a click outside still lands and a right-click elsewhere moves the menu there. */}
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>
            <div
              ref={contentRef}
              className="content"
              onMouseDown={onContentMouseDown}
              onClick={(e) => {
                if (!e.shiftKey && !(IS_MAC ? e.metaKey : e.ctrlKey)) select([]);
              }}
              // Picks the menu's item before the menu opens: the one under the
              // pointer, selected unless it already is, or the empty space.
              onContextMenu={(e) => {
                const key = (e.target as Element).closest<HTMLElement>("[data-key]")?.dataset.key ?? null;
                if (key === null) select([]);
                else if (!selected.has(key)) select([key]);
                setMenu((m) => ({ target: key, opened: m.opened + 1 }));
              }}
            >
              {mode === "Icons" ? <IconView {...viewProps} /> : <ListView {...viewProps} />}
              {marquee.box && <div className="marquee" style={marquee.box} />}
              {isEmpty && noAccess && (
                <NoAccess
                  name={baseName(cwd)}
                  asked={accessAsked}
                  onSettings={askFullDiskAccess}
                  onReveal={revealAppBundle}
                  onRestart={() => report(engine.relaunch())}
                />
              )}
              {isEmpty && !noAccess && (
                <Empty className="py-20">
                  <EmptyHeader>
                    <EmptyDescription>
                      {query
                        ? `${searchKinds.length === 1 ? `No ${searchKinds[0]}` : "Nothing"}${searchAll ? "" : ` in ${displayPath(cwd, home)}`} ${searchKinds.length === 1 ? "match" : "matches"} “${query}”.`
                        : listing.error
                          ? `Can't open this folder: ${listing.error}`
                          : hiddenFolders > 0
                            ? `No downloads here. ${plural(hiddenFolders, "folder")} without downloads ${hiddenFolders === 1 ? "is" : "are"} hidden.`
                            : "This folder is empty. Right-click to add a download or a queue."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </ContextMenuTrigger>
          {/* A new menu each time, so one opened over another takes focus as the first did. */}
          <ContextMenuContent key={menu.opened}>
            <ContextMenuItems ctx={menuContext} target={menu.target} />
          </ContextMenuContent>
        </ContextMenu>
        {overviewOpen && (
          <Overview
            rows={overview}
            show={overviewShow}
            onShow={setOverviewShow}
            running={global.active}
            speed={global.speed}
            onOpenFile={(dir, id) => go(dir, id)}
            onAction={onAction}
            onPauseAll={() => report(pauseAll(state))}
          />
        )}
        {queuePanelOpen && (
          <QueueSettings
            queue={
              settingsQueue
                ? {
                    id: settingsQueue.id,
                    name: baseName(settingsQueue.dir) || settingsQueue.dir,
                    path: displayPath(settingsQueue.dir, home),
                    settings: settingsQueue.settings,
                  }
                : null
            }
            files={settingsQueueFiles}
            items={settingsQueueItems}
            onRename={(renames) => renames.forEach(({ id, name }) => report(engine.renameDownload(id, name)))}
            onSettings={(settings) => settingsQueue && report(engine.setQueueSettings(settingsQueue.id, settings))}
            onReorder={(ids) => settingsQueue && report(engine.reorderQueue(settingsQueue.id, ids))}
            onClose={() => setQueuePanel("closed")}
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

      {pasting && (
        <PasteBar
          urls={pasting}
          dir={cwd}
          rename={queueForDir(state, cwd)?.settings.rename}
          dirLabel={displayPath(cwd, home)}
          onAdd={(urls, always) => {
            if (always) setPasteMode("always");
            addLinks(urls).catch((e) => setNotice(`Couldn't add: ${e}`));
          }}
          onClose={() => setPasting(null)}
        />
      )}

      {captured && captured.length > 0 && (
        <CapturedBar
          urls={captured}
          dir={cwd}
          rename={queueForDir(state, cwd)?.settings.rename}
          dirLabel={displayPath(cwd, home)}
          onAdd={(urls) => addLinks(urls).catch((e) => setNotice(`Couldn't add: ${e}`))}
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

      <RefreshLink
        download={
          refreshing && state.downloads[refreshing]
            ? { name: displayName(state.downloads[refreshing]), url: state.downloads[refreshing].url }
            : null
        }
        captured={refreshCapture}
        onSave={(url) => {
          const id = refreshing!;
          engine
            .setDownloadUrl(id, url)
            .then(() => engine.resume(id))
            .catch((e) => setNotice(`Couldn't refresh the link: ${e}`));
        }}
        onClose={() => {
          setRefreshing(null);
          setRefreshCapture(null);
        }}
      />
      <Settings
        open={settingsOpen}
        sortOrder={sortOrder}
        onSortOrder={setSortOrder}
        pasteMode={pasteMode}
        onPasteMode={setPasteMode}
        appearance={{
          theme: themePref,
          onTheme: setThemePref,
          resolvedTheme: theme,
          accent,
          onAccent: setAccent,
          density,
          onDensity: setDensity,
        }}
        access={
          IS_MAC && home
            ? {
                home,
                fullDisk,
                asked: accessAsked,
                root,
                folders: accessFolders,
                onFullDiskAccess: askFullDiskAccess,
                onRestart: () => report(engine.relaunch()),
                onAddFolder: addAccessFolder,
                onRemoveFolder: removeAccessFolder,
              }
            : undefined
        }
        onResetOnboarding={import.meta.env.DEV ? resetOnboarding : undefined}
        onClose={closeSettings}
      />
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
          {drag.keys.length === 1 ? nameOf(drag.keys[0]) : plural(drag.keys.length, "item")}
        </div>
      )}
    </div>
  );
}
