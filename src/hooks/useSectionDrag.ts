import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { sectionDropIndex, type SectionId } from "../lib/sidebar";
import { swallowClick } from "./useItemDrag";

/** Distance the pointer must travel before a press on a header becomes a drag. */
const THRESHOLD = 4;

export interface SectionDrag {
  id: SectionId;
  /** The gap among the sections showing that it would drop in. */
  index: number;
}

/**
 * Drags the sidebar's sections by their headers, among the elements marked
 * `data-section` in `container`. A press that doesn't move stays a click.
 */
export function useSectionDrag(container: RefObject<HTMLElement | null>, onDrop: (id: SectionId, index: number) => void) {
  const [drag, setDrag] = useState<SectionDrag | null>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (e: ReactMouseEvent, id: SectionId) => {
      if (e.button !== 0) return;
      cleanup.current?.();
      const y0 = e.clientY;
      let current: SectionDrag | null = null;

      const onMove = (e: MouseEvent) => {
        if (!current && Math.abs(e.clientY - y0) < THRESHOLD) return;
        const sections = container.current?.querySelectorAll<HTMLElement>("[data-section]") ?? [];
        const middles = [...sections].map((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        current = { id, index: sectionDropIndex(middles, e.clientY) };
        setDrag(current);
      };
      const onUp = () => {
        const dropped = current;
        stop();
        if (!dropped) return;
        swallowClick();
        drop.current(dropped.id, dropped.index);
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
    },
    [container],
  );

  return { drag, start };
}
