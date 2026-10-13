import { useCallback, useEffect, useMemo, useState } from "react";
import { InputBar, StatusBar, Toolbar, type Theme } from "./components/Bars";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { IconView, ListView, type ItemViewProps } from "./components/ItemViews";
import { useDirListing } from "./hooks/useDirListing";
import { useEngine } from "./hooks/useEngine";
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
  const [selected, setSelected] = useState<string | null>(null);
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

  const go = useCallback((path: string, select: string | null = null) => {
    setHistory((h) => (h && h.cwd !== path ? { cwd: path, back: [...h.back, h.cwd], forward: [] } : h));
    setSelected(select);
  }, []);

  const goBack = () => {
    if (!history?.back.length) return;
    const back = [...history.back];
    const cwd = back.pop()!;
    setHistory({ cwd, back, forward: [history.cwd, ...history.forward] });
    setSelected(null);
  };
  const goForward = () => {
    if (!history?.forward.length) return;
    const [cwd, ...forward] = history.forward;
    setHistory({ cwd, back: [...history.back, history.cwd], forward });
    setSelected(null);
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
            .map((item) => fileVm(item, queue, state, mode, listing.present))
        : [],
    [state, queue, mode, listing],
  );

  const onAction = (vm: FileVm) => {
    report(vm.action === "pause" ? engine.pause(vm.id) : engine.resume(vm.id));
  };
  const onOpenFile = (vm: FileVm) => {
    if (vm.done && !vm.missing && vm.path) report(engine.openPath(vm.path));
  };

  // Delete/Backspace removes the selected download (its file stays if finished).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected && state.downloads[selected]) {
        report(engine.remove(selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, state.downloads]);

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
        setSelected(path);
        setEditing(path);
      })
      .catch((e) => console.error(e));
  };

  const rename = async (path: string, name: string) => {
    const renamed = await engine.renameFolder(path, name);
    setEditing(null);
    setSelected(renamed);
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
      items.push(
        { kind: "separator" },
        {
          kind: "action",
          label: settings.paused ? "Resume queue" : "Pause queue",
          onSelect: () => report(engine.setQueueSettings(queue.id, { ...settings, paused: !settings.paused })),
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
          setSelected(null);
        },
      },
    );
    return items;
  };

  const menuItems = (target: string | null): MenuItem[] => {
    if (target === null) return backgroundMenu();
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
  const selFile = files.find((f) => f.id === selected);
  const selFolder = folders.find((g) => g.path === selected);
  const viewProps: ItemViewProps = {
    folders,
    files,
    selected,
    onSelect: setSelected,
    onOpenFolder: (path) => go(path),
    onOpenFile,
    onAction,
    onItemMenu: (target, x, y) => setMenu({ x, y, target }),
    editing,
    onRename: rename,
    onCancelRename: () => setEditing(null),
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
            setSelected(await engine.addDownload(cwd, url));
          }}
          onClose={() => setAdding(false)}
        />
      )}

      <div
        className="content"
        onClick={() => setSelected(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSelected(null);
          setMenu({ x: e.clientX, y: e.clientY, target: null });
        }}
      >
        {mode === "Icons" ? <IconView {...viewProps} /> : <ListView {...viewProps} />}
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
          selFile ? selFile.info : selFolder ? `${displayPath(selFolder.path, home)} — double-click to open` : ""
        }
        left={`${global.active} downloading · ${global.queued} waiting`}
        speed={`↓ ${formatSpeed(global.speed)}`}
        warning={state.saveError}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.target)} onClose={closeMenu} />}
    </div>
  );
}
