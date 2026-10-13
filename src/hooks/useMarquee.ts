import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { swallowClick } from "./useItemDrag";

/** Distance the pointer must travel before a press on empty space draws a box. */
const THRESHOLD = 3;
/** How close to the top or bottom edge the pointer must be to scroll, and how fast. */
const SCROLL_EDGE = 24;
const SCROLL_STEP = 12;

/** A box in the container's scrolled content coordinates. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Finder-style rubber-band selection: dragging from empty space in `container`
 * draws a box and reports the keys (`data-key`) of the items it touches.
 * Scrolls when the pointer goes past the top or bottom edge.
 */
export function useMarquee(container: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<Box | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (e: ReactMouseEvent, onChange: (keys: string[]) => void) => {
      const el = container.current;
      if (!el) return;
      cleanup.current?.();
      const toContent = (x: number, y: number) => {
        const rect = el.getBoundingClientRect();
        return { x: x - rect.left + el.scrollLeft, y: y - rect.top + el.scrollTop };
      };
      const origin = toContent(e.clientX, e.clientY);
      let pointer = { x: e.clientX, y: e.clientY };
      let active = false;
      let frame = 0;

      const update = () => {
        const p = toContent(pointer.x, pointer.y);
        const current = {
          left: Math.min(origin.x, p.x),
          top: Math.min(origin.y, p.y),
          width: Math.abs(p.x - origin.x),
          height: Math.abs(p.y - origin.y),
        };
        setBox(current);
        const rect = el.getBoundingClientRect();
        const hits: string[] = [];
        for (const item of el.querySelectorAll<HTMLElement>("[data-key]")) {
          const r = item.getBoundingClientRect();
          const left = r.left - rect.left + el.scrollLeft;
          const top = r.top - rect.top + el.scrollTop;
          if (
            left < current.left + current.width &&
            left + r.width > current.left &&
            top < current.top + current.height &&
            top + r.height > current.top
          ) {
            hits.push(item.dataset.key!);
          }
        }
        onChange(hits);
      };
      // Keeps scrolling while the pointer rests past an edge.
      const tick = () => {
        const rect = el.getBoundingClientRect();
        const dy =
          pointer.y < rect.top + SCROLL_EDGE ? -SCROLL_STEP : pointer.y > rect.bottom - SCROLL_EDGE ? SCROLL_STEP : 0;
        if (dy) {
          const before = el.scrollTop;
          el.scrollTop += dy;
          if (el.scrollTop !== before) update();
        }
        frame = requestAnimationFrame(tick);
      };
      const onMove = (e: MouseEvent) => {
        pointer = { x: e.clientX, y: e.clientY };
        if (!active) {
          const p = toContent(pointer.x, pointer.y);
          if (Math.hypot(p.x - origin.x, p.y - origin.y) < THRESHOLD) return;
          active = true;
          frame = requestAnimationFrame(tick);
        }
        update();
      };
      const onUp = () => {
        if (active) swallowClick();
        stop();
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", stop);
        cleanup.current = null;
        setBox(null);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("blur", stop);
      cleanup.current = stop;
    },
    [container],
  );

  return { box, start };
}
