import { useRef, useState } from "react";
import { engine } from "../lib/engine";
import { isFolderKey } from "../lib/keys";
import { baseName, joinPath, parentPath } from "../lib/paths";
import type { FileVm } from "../lib/viewModels";
import type { EngineState } from "./useEngine";
import type { Undo } from "./useUndo";

/** Items cut or copied, waiting to be pasted: download ids and folder paths. */
export interface Clip {
  keys: string[];
  /** Pasting moves them rather than copying them. */
  cut: boolean;
}

interface Options {
  state: EngineState;
  /** The files in view, for the paths of finished downloads. */
  files: FileVm[];
  cwd: string | null;
  select: (keys: string[]) => void;
  setNotice: (notice: string | null) => void;
  /** Re-lists the folder after the engine changed it. */
  refresh: () => void;
  pushUndo: (undo: Undo) => void;
  /** Adds the links in text pasted from another app. */
  pasteLinks: (text: string) => void;
}

/** Cutting, copying and pasting downloads and folders. */
export function useClipboardItems({ state, files, cwd, select, setNotice, refresh, pushUndo, pasteLinks }: Options) {
  const [clip, setClip] = useState<Clip | null>(null);
  /** What cutting or copying last put on the system clipboard; null if that failed. */
  const clipText = useRef<string | null>(null);

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
      .finally(refresh);
  };

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

  return { clip, setClip, clipItems, pasteItems, paste };
}
