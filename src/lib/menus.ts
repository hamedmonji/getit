// The context menus for the folder's empty space, its items and the selection.

import type { Clip } from "../hooks/useClipboardItems";
import type { EngineState } from "../hooks/useEngine";
import { engine, type QueueInfo } from "./engine";
import { plural } from "./format";
import { FILE_MANAGER, IS_MAC, MOD } from "./platform";
import { hasWork, isQueuePaused, pauseQueue, resumeQueue } from "./queueControl";
import { report } from "./report";
import { queueForDir, type FileVm, type FolderVm } from "./viewModels";

export type MenuItem =
  | {
      kind: "action";
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** Shows a check mark column; true checks it. */
      checked?: boolean;
      /** Keyboard shortcut shown on the right, such as "⌘C". */
      shortcut?: string;
    }
  | { kind: "separator" }
  | { kind: "header"; label: string }
  /** A −/+ control; changing it keeps the menu open. */
  | {
      kind: "stepper";
      label: string;
      value: number;
      min: number;
      max: number;
      onChange: (value: number) => void;
    };

/** Most downloads a queue can run at once, as offered in the menu. */
const MAX_CONCURRENCY = 6;

/** What the menus show and the actions they run. */
export interface MenuContext {
  state: EngineState;
  cwd: string;
  /** This folder's queue, if it has one. */
  queue: QueueInfo | undefined;
  /** The queue's status, as a header. */
  summary: string;
  /** Finished downloads in this folder's queue. */
  doneHere: number;
  clip: Clip | null;
  query: string;
  /** The selected items in view, in display order. */
  selection: string[];
  selected: Set<string>;
  folders: FolderVm[];
  files: FileVm[];
  selectedFiles: FileVm[];
  select: (keys: string[]) => void;
  go: (path: string) => void;
  startAdding: () => void;
  pasteItems: (dest: string) => void;
  pasteLinks: (text: string) => void;
  newQueue: () => void;
  openQueuePanel: () => void;
  onOpenFile: (vm: FileVm) => void;
  pauseDownloads: (ids: string[]) => void;
  showInFolder: (key: string) => void;
  /** Where an item is on disk: its file, or for unfinished downloads their folder. */
  diskPath: (key: string) => string | undefined;
  clipItems: (keys: string[], cut: boolean) => void;
  trashItems: (keys: string[]) => void;
  setEditing: (key: string) => void;
}

const RENAME_SHORTCUT = IS_MAC ? "↩" : "Enter";

const showInFolderItem = (ctx: MenuContext, key: string): MenuItem => ({
  kind: "action",
  label: "Show in Enclosing Folder",
  onSelect: () => ctx.showInFolder(key),
});

const revealItem = (ctx: MenuContext, keys: string[]): MenuItem => ({
  kind: "action",
  label: `Show in ${FILE_MANAGER}`,
  onSelect: () => {
    const paths = [...new Set(keys.map(ctx.diskPath).filter((p): p is string => !!p))];
    if (paths.length) report(engine.reveal(paths));
  },
});

const clipMenu = (ctx: MenuContext, keys: string[]): MenuItem[] => [
  { kind: "action", label: "Cut", shortcut: `${MOD}X`, onSelect: () => ctx.clipItems(keys, true) },
  { kind: "action", label: "Copy", shortcut: `${MOD}C`, onSelect: () => ctx.clipItems(keys, false) },
];

const pasteLabel = (clip: Clip | null) => (clip ? `Paste ${plural(clip.keys.length, "item")}` : "Paste");

export function backgroundMenu(ctx: MenuContext): MenuItem[] {
  const { state, queue, clip, cwd } = ctx;
  const items: MenuItem[] = [];
  if (queue) items.push({ kind: "header", label: ctx.summary || "Queue" });
  items.push(
    { kind: "action", label: "Add download…", onSelect: ctx.startAdding },
    ...(clip
      ? [{ kind: "action", label: pasteLabel(clip), shortcut: `${MOD}V`, onSelect: () => ctx.pasteItems(cwd) } as const]
      : []),
    {
      kind: "action",
      label: "Paste link",
      onSelect: () => engine.readClipboard().then(ctx.pasteLinks).catch(() => {}),
    },
    { kind: "action", label: "New queue", shortcut: `${MOD}N`, onSelect: ctx.newQueue },
    { kind: "action", label: `Open in ${FILE_MANAGER}`, onSelect: () => report(engine.openPath(cwd)) },
  );
  if (queue) {
    const { settings } = queue;
    const paused = isQueuePaused(state, queue);
    items.push(
      { kind: "separator" },
      {
        kind: "action",
        label: paused ? "Resume queue" : "Pause queue",
        disabled: !hasWork(state, queue),
        onSelect: () => report(paused ? resumeQueue(state, queue) : pauseQueue(state, queue)),
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
        disabled: ctx.doneHere === 0,
        onSelect: () => report(engine.clearCompleted(queue.id)),
      },
      {
        kind: "action",
        label: "Queue Settings…",
        shortcut: `${MOD}/`,
        onSelect: ctx.openQueuePanel,
      },
    );
  }
  return items;
}

export function downloadMenu(ctx: MenuContext, vm: FileVm): MenuItem[] {
  const status = ctx.state.downloads[vm.id]?.status;
  const items: MenuItem[] = [];
  if (vm.done) {
    items.push({
      kind: "action",
      label: "Open",
      disabled: vm.missing || !vm.path,
      onSelect: () => ctx.onOpenFile(vm),
    });
  } else {
    if (status === "downloading" || status === "queued") {
      if (vm.action === "resume") {
        // Waiting in a paused queue: start it on its own.
        items.push({ kind: "action", label: "Resume", onSelect: () => report(engine.resume(vm.id)) });
      }
      items.push({ kind: "action", label: "Pause", onSelect: () => ctx.pauseDownloads([vm.id]) });
    } else {
      items.push({
        kind: "action",
        label: status === "failed" ? "Retry" : "Resume",
        onSelect: () => report(engine.resume(vm.id)),
      });
    }
  }
  if (ctx.query) items.push(showInFolderItem(ctx, vm.id));
  items.push(revealItem(ctx, [vm.id]));
  items.push({ kind: "action", label: "Rename", shortcut: RENAME_SHORTCUT, onSelect: () => ctx.setEditing(vm.id) });
  items.push({ kind: "separator" }, ...clipMenu(ctx, [vm.id]), { kind: "separator" });
  if (vm.done) {
    // The file stays on disk.
    items.push({
      kind: "action",
      label: "Remove from list",
      onSelect: () => {
        report(engine.remove(vm.id));
        ctx.select([]);
      },
    });
  }
  items.push({ kind: "action", label: "Move to Trash", danger: true, onSelect: () => ctx.trashItems([vm.id]) });
  return items;
}

export function selectionMenu(ctx: MenuContext): MenuItem[] {
  const { state, selection, selectedFiles } = ctx;
  const items: MenuItem[] = [{ kind: "header", label: `${plural(selection.length, "item")} selected` }];
  const trash: MenuItem = {
    kind: "action",
    label: `Move ${plural(selection.length, "item")} to Trash`,
    danger: true,
    onSelect: () => ctx.trashItems(selection),
  };
  items.push(revealItem(ctx, selection), { kind: "separator" }, ...clipMenu(ctx, selection), { kind: "separator" });
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
      onSelect: () => ctx.pauseDownloads(pausable.map((f) => f.id)),
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
        ctx.select([]);
      },
    });
  }
  items.push(trash);
  return items;
}

export function folderMenu(ctx: MenuContext, target: string): MenuItem[] {
  const { state, clip } = ctx;
  const folderQueue = queueForDir(state, target);
  return [
    { kind: "action", label: "Open", onSelect: () => ctx.go(target) },
    ...(folderQueue
      ? [
          isQueuePaused(state, folderQueue)
            ? ({
                kind: "action",
                label: "Resume queue",
                disabled: !hasWork(state, folderQueue),
                onSelect: () => report(resumeQueue(state, folderQueue)),
              } as const)
            : ({
                kind: "action",
                label: "Pause queue",
                disabled: !hasWork(state, folderQueue),
                onSelect: () => report(pauseQueue(state, folderQueue)),
              } as const),
          {
            kind: "action",
            label: "Queue Settings…",
            // The panel shows the selected queue folder's queue.
            onSelect: () => {
              ctx.select([target]);
              ctx.openQueuePanel();
            },
          } as const,
        ]
      : []),
    ...(ctx.query ? [showInFolderItem(ctx, target)] : []),
    revealItem(ctx, [target]),
    { kind: "action", label: "Rename", shortcut: RENAME_SHORTCUT, onSelect: () => ctx.setEditing(target) },
    { kind: "separator" },
    ...clipMenu(ctx, [target]),
    ...(clip && !clip.keys.includes(target)
      ? [{ kind: "action", label: `${pasteLabel(clip)} Into Folder`, onSelect: () => ctx.pasteItems(target) } as const]
      : []),
    { kind: "separator" },
    { kind: "action", label: "Move to Trash", danger: true, onSelect: () => ctx.trashItems([target]) },
  ];
}

/** The menu for `target`: a folder path or download id, or null for the folder's empty space. */
export function menuItems(ctx: MenuContext, target: string | null): MenuItem[] {
  if (target === null) return backgroundMenu(ctx);
  if (ctx.selection.length > 1 && ctx.selected.has(target)) return selectionMenu(ctx);
  const file = ctx.files.find((f) => f.id === target);
  if (file) return downloadMenu(ctx, file);
  if (ctx.folders.some((g) => g.path === target)) return folderMenu(ctx, target);
  return [];
}
