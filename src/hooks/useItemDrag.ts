import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

/** Distance the pointer must travel before a press becomes a drag. */
const THRESHOLD = 4;

export interface Drag {
  keys: string[];
  x: number;
  y: number;
  /** Folder path under the pointer that accepts the drop, if any. */
  target: string | null;
}

/** Keeps the click that ends a drag from selecting or deselecting anything. */
export function swallowClick() {
  const swallow = (e: MouseEvent) => e.stopPropagation();
  window.addEventListener("click", swallow, true);
  setTimeout(() => window.removeEventListener("click", swallow, true));
}

/** The folder path of the `data-drop` element under (x, y). */
function dropAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
  return el?.getAttribute("data-drop") ?? null;
}

/**
 * Drags items onto elements marked with `data-drop="<folder path>"`. Uses mouse
 * events rather than HTML drag and drop, which the webview reserves for files
 * dropped from outside the app.
 */
export function useItemDrag(
  canDrop: (keys: string[], target: string) => boolean,
  onDrop: (keys: string[], target: string) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const callbacks = useRef({ canDrop, onDrop });
  callbacks.current = { canDrop, onDrop };
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback((e: ReactMouseEvent, keys: string[]) => {
    cleanup.current?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let current: Drag | null = null;

    const update = (x: number, y: number) => {
      const over = dropAt(x, y);
      const target = over !== null && callbacks.current.canDrop(keys, over) ? over : null;
      current = { keys, x, y, target };
      setDrag(current);
    };
    const onMove = (e: MouseEvent) => {
      if (!current && Math.hypot(e.clientX - x0, e.clientY - y0) < THRESHOLD) return;
      update(e.clientX, e.clientY);
    };
    const onUp = () => {
      const dropped = current;
      stop();
      if (!dropped) return;
      swallowClick();
      if (dropped.target !== null) callbacks.current.onDrop(dropped.keys, dropped.target);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    const stop = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", stop);
      cleanup.current = null;
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", stop);
    cleanup.current = stop;
  }, []);

  return { drag, start };
}
