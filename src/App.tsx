import { useCallback, useEffect, useMemo, useState } from "react";
import { AddBar, QueueBar, StatusBar, Toolbar, type Theme } from "./components/Bars";
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

function report(promise: Promise<unknown>) {
  promise.catch((e) => console.error(e));
}

export default function App() {
  const state = useEngine();
  const [home, setHome] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
  const all = Object.values(state.downloads);
  const refreshKey = `${all.length}:${all.filter((d) => d.status === "completed").length}`;
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
        <AddBar
          dirLabel={displayPath(cwd, home)}
          onAdd={async (url) => {
            const id = await engine.addDownload(cwd, url);
            setSelected(id);
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {queue && (queue.downloads.length > 0 || queue.settings.paused) && (
        <QueueBar
          summary={summary}
          pct={own.pct}
          maxConcurrent={queue.settings.max_concurrent}
          paused={queue.settings.paused}
          onConcurrency={(n) => report(engine.setQueueSettings(queue.id, { ...queue.settings, max_concurrent: n }))}
          onTogglePause={() =>
            report(engine.setQueueSettings(queue.id, { ...queue.settings, paused: !queue.settings.paused }))
          }
          onClearDone={() => report(engine.clearCompleted(queue.id))}
        />
      )}

      <div className="content" onClick={() => setSelected(null)}>
        {mode === "Icons" ? <IconView {...viewProps} /> : <ListView {...viewProps} />}
        {count === 0 && listing.loaded && state.loaded && (
          <div className="empty">
            {listing.error
              ? `Can't open this folder: ${listing.error}`
              : hiddenFolders > 0
                ? `No downloads here. ${plural(hiddenFolders, "folder")} without downloads ${hiddenFolders === 1 ? "is" : "are"} hidden.`
                : "This folder is empty. Use Add link to download something into it."}
          </div>
        )}
      </div>

      <StatusBar
        itemCount={plural(count, "item")}
        selInfo={
          selFile ? selFile.info : selFolder ? `${displayPath(selFolder.path, home)} — double-click to open` : ""
        }
        left={`${global.active} downloading · ${global.queued} waiting`}
        speed={`↓ ${formatSpeed(global.speed)}`}
        warning={state.saveError}
      />
    </div>
  );
}
