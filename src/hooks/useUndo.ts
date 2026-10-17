import { useRef } from "react";

/** A change Command-Z can take back. */
export interface Undo {
  /** What it undoes, such as "Move to Trash". */
  label: string;
  run: () => Promise<unknown>;
}

/** How many changes Command-Z can go back through. */
const MAX_UNDOS = 50;

/**
 * Changes that can be undone, newest last. `undo` takes back the last one,
 * reporting a failure through `onNotice`, then calls `onDone` whatever happened.
 */
export function useUndo(onNotice: (notice: string | null) => void, onDone: () => void) {
  // A ref rather than state: nothing shows the list, and Command-Z pressed
  // twice before a re-render must take back two changes, not one twice.
  const undos = useRef<Undo[]>([]);

  const push = (undo: Undo) => {
    undos.current = [...undos.current.slice(1 - MAX_UNDOS), undo];
  };
  const undo = () => {
    const last = undos.current.pop();
    if (!last) return;
    last
      .run()
      .then(() => onNotice(null))
      .catch((e) => onNotice(`Couldn't undo: ${e}`))
      .finally(onDone);
  };

  return { push, undo };
}
