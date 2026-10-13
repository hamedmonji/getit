import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { InputBar, StatusBar, Toolbar, type Theme } from "./components/Bars";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { IconView, ListView, type ItemViewProps } from "./components/ItemViews";
import { useDirListing } from "./hooks/useDirListing";
import { useEngine } from "./hooks/useEngine";
import { useItemDrag } from "./hooks/useItemDrag";
import { useMarquee } from "./hooks/useMarquee";
import { useStoredState } from "./hooks/useStoredState";
import { engine } from "./lib/engine";
import { formatSpeed, plural } from "./lib/format";
import { crumbsFrom, displayPath, isWithin, parentPath } from "./lib/paths";
import {
  fileVm,
  folderVm,
  queueForDir,
  stats,
  type FileVm,
  type ViewMode,
} from "./lib/viewModels";

interface History {
  cwd: string;
  back: string[];
  forward: string[];
}

/** On macOS, Control-click opens the context menu and Command adds to the selection. */
const IS_MAC = navigator.userAgent.includes("Mac");

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

function report(promise: Promise<unknown>) {
  promise.catch((e) => console.error(e));
}

export default function App() {
  const state = useEngine();
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
    () => "all",
  );
  const showAllFolders = folderFilter === "all";

  useEffect(() => {
    Promise.all([engine.homeDir(), engine.initialDir()]).then(([home, start]) => {
      setHome(home);
      setHistory({ cwd: start, back: [], forward: [] });
    });
  }, []);

  const cwd = history?.cwd ?? null;
  useEffect(() => setEditing(null), [cwd]);
  const all = Object.values(state.downloads);
  const refreshKey = [
    all.length,
    all.filter((d) => d.status === "completed").length,
    Object.keys(state.queues).length,
    listNonce,
  ].join(":");
  const listing = useDirListing(cwd, refreshKey);

  const go = useCallback(
    (path: string, focus: string | null = null) => {
      setHistory((h) => (h && h.cwd !== path ? { cwd: path, back: [...h.back, h.cwd], forward: [] } : h));
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
  const canUp = !!home && !!cwd && cwd !== home && isWithin(cwd, home);
  const goUp = () => {
    if (canUp && cwd) go(parentPath(cwd), cwd);
  };

  const queue = cwd ? queueForDir(state, cwd) : undefined;
  const allFolders = useMemo(
    () => (cwd ? listing.folders.map((f) => folderVm(state, cwd, f)) : []),
    [state, cwd, listing],
  );
  const folders = showAllFolders ? allFolders : allFolders.filter((g) => g.hasQueue);
  const hiddenFolders = allFolders.length - folders.length;
  const files = useMemo(
    () =>
      queue
        ? queue.downloads
            .map((id) => state.downloads[id])
            .filter(Boolean)
            .map((item) => fileVm(item, queue, state, mode, listing.loaded ? listing.present : null))
        : [],
    [state, queue, mode, listing],
  );

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
    (keys, target) => target !== cwd && !keys.includes(target),
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

  const onAction = (vm: FileVm) => {
    report(vm.action === "pause" ? engine.pause(vm.id) : engine.resume(vm.id));
  };
  const onOpenFile = (vm: FileVm) => {
    if (vm.done && !vm.missing && vm.path) report(engine.openPath(vm.path));
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

  // Delete/Backspace removes the selected downloads (finished files stay);
  // Command-A selects everything in the folder; Command-Down opens the selected
  // item and Command-Up goes to the enclosing folder (Control-A and Alt-arrows elsewhere).
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
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const ids = selectedFiles.map((f) => f.id);
        if (!ids.length) return;
        ids.forEach((id) => report(engine.remove(id)));
        select([]);
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

  const own = stats(state, cwd, false);
  const summary = [
    queue?.settings.paused && "Paused",
    own.active && `${own.active} downloading`,
    own.queued && `${own.queued} waiting`,
    own.done && `${own.done} done`,
    own.active && formatSpeed(own.speed),
  ]
    .filter(Boolean)
    .join(" · ");

  // Like Finder's New Folder: create it with a default name, then edit the name in place.
  const newQueue = () => {
    engine
      .createQueue(cwd)
      .then((path) => {
        setListNonce((n) => n + 1);
        select([path]);
        setEditing(path);
      })
      .catch((e) => console.error(e));
  };

  const rename = async (path: string, name: string) => {
    const renamed = await engine.renameFolder(path, name);
    setEditing(null);
    select([renamed]);
    setListNonce((n) => n + 1);
  };

  const backgroundMenu = (): MenuItem[] => {
    const items: MenuItem[] = [];
    if (queue) items.push({ kind: "header", label: summary ? `Queue · ${summary}` : "Queue" });
    items.push(
      { kind: "action", label: "Add download…", onSelect: () => setAdding(true) },
      { kind: "action", label: "New queue", onSelect: newQueue },
    );
    if (queue) {
      const { settings } = queue;
      const held = queue.downloads.filter((id) => state.downloads[id]?.status === "paused");
      // Downloads paused one by one stop the queue as surely as pausing it does.
      const stopped = settings.paused || (own.active === 0 && own.queued === 0 && held.length > 0);
      const resumeQueue = async () => {
        if (settings.paused) await engine.setQueueSettings(queue.id, { ...settings, paused: false });
        if (held.length) await engine.requeue(held);
      };
      items.push(
        { kind: "separator" },
        {
          kind: "action",
          label: stopped ? "Resume queue" : "Pause queue",
          onSelect: () =>
            report(stopped ? resumeQueue() : engine.setQueueSettings(queue.id, { ...settings, paused: true })),
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
        items.push({ kind: "action", label: "Pause", onSelect: () => report(engine.pause(vm.id)) });
      } else {
        items.push({
          kind: "action",
          label: status === "failed" ? "Retry" : "Resume",
          onSelect: () => report(engine.resume(vm.id)),
        });
      }
    }
    items.push(
      { kind: "separator" },
      {
        kind: "action",
        // A finished file stays on disk; an unfinished one's partial data is deleted.
        label: vm.done ? "Remove from list" : "Delete",
        danger: !vm.done,
        onSelect: () => {
          report(engine.remove(vm.id));
          select([]);
        },
      },
    );
    return items;
  };

  const selectionMenu = (): MenuItem[] => {
    const items: MenuItem[] = [{ kind: "header", label: `${plural(selection.length, "item")} selected` }];
    if (!selectedFiles.length) return items;
    const status = (f: FileVm) => state.downloads[f.id]?.status;
    const queuePaused = queue?.settings.paused ?? false;
    const pausable = selectedFiles.filter((f) => status(f) === "downloading" || status(f) === "queued");
    const resumable = selectedFiles.filter((f) => status(f) === "paused" || status(f) === "failed");
    const unfinished = selectedFiles.some((f) => !f.done);
    const count = plural(selectedFiles.length, "download");
    items.push(
      {
        kind: "action",
        label: "Pause",
        disabled: !pausable.length,
        onSelect: () => pausable.forEach((f) => report(engine.pause(f.id))),
      },
      {
        kind: "action",
        label: "Resume",
        disabled: !resumable.length,
        // Back in line, so the queue's limit holds; a paused queue gets them started on their own.
        onSelect: () =>
          queuePaused
            ? resumable.forEach((f) => report(engine.resume(f.id)))
            : report(engine.requeue(resumable.map((f) => f.id))),
      },
      { kind: "separator" },
      {
        kind: "action",
        // Finished files stay on disk; unfinished ones' partial data is deleted.
        label: unfinished ? `Delete ${count}` : `Remove ${count} from list`,
        danger: unfinished,
        onSelect: () => {
          selectedFiles.forEach((f) => report(engine.remove(f.id)));
          select([]);
        },
      },
    );
    return items;
  };

  const menuItems = (target: string | null): MenuItem[] => {
    if (target === null) return backgroundMenu();
    if (selection.length > 1 && selected.has(target)) return selectionMenu();
    const file = files.find((f) => f.id === target);
    if (file) return downloadMenu(file);
    if (folders.some((g) => g.path === target)) {
      return [
        { kind: "action", label: "Open", onSelect: () => go(target) },
        { kind: "action", label: "Rename", onSelect: () => setEditing(target) },
      ];
    }
    return [];
  };

  const global = stats(state, "/", true);
  const count = folders.length + files.length;
  const single = selection.length === 1 ? selection[0] : null;
  const selFile = files.find((f) => f.id === single);
  const selFolder = folders.find((g) => g.path === single);
  const nameOf = (key: string) =>
    folders.find((g) => g.path === key)?.name ?? files.find((f) => f.id === key)?.name ?? key;
  const viewProps: ItemViewProps = {
    folders,
    files,
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
        crumbs={crumbsFrom(home, cwd)}
        onCrumb={(path) => go(path)}
        dropTarget={drag?.target ?? null}
        mode={mode}
        onMode={setMode}
        showAllFolders={showAllFolders}
        onToggleFolders={() => setFolderFilter(showAllFolders ? "queues" : "all")}
        onToggleAdd={() => setAdding((a) => !a)}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "Dark" ? "Light" : "Dark")}
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
            select([await engine.addDownload(cwd, url)]);
          }}
          onClose={() => setAdding(false)}
        />
      )}

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
        {count === 0 && listing.loaded && state.loaded && (
          <div className="empty">
            {listing.error
              ? `Can't open this folder: ${listing.error}`
              : hiddenFolders > 0
                ? `No downloads here. ${plural(hiddenFolders, "folder")} without downloads ${hiddenFolders === 1 ? "is" : "are"} hidden.`
                : "This folder is empty. Right-click to add a download or a queue."}
          </div>
        )}
      </div>

      <StatusBar
        itemCount={plural(count, "item") + (queue?.settings.paused ? " · Queue paused" : "")}
        selInfo={
          selFile
            ? selFile.info
            : selFolder
              ? `${displayPath(selFolder.path, home)} — double-click to open`
              : selection.length > 1
                ? `${plural(selection.length, "item")} selected — drag onto a folder to move`
                : ""
        }
        left={`${global.active} downloading · ${global.queued} waiting`}
        speed={`↓ ${formatSpeed(global.speed)}`}
        warning={state.saveError}
        notice={notice}
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
