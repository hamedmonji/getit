import { useLayoutEffect, useRef, useState } from "react";
import { alignedOffset } from "../lib/onboarding";

/**
 * Lines a step's column up with the showcase beside it. Returns the refs to
 * put on the showcase, the column and the column's empty filler, and the extra
 * top padding to give the column.
 */
export function useAlignedOffset() {
  const showcase = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const filler = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const current = useRef(0);

  useLayoutEffect(() => {
    const measure = () => {
      const [s, c, f] = [showcase.current, column.current, filler.current];
      if (!s || !c || !f) return;
      const scroller = scrollerOf(c);
      const padding = parseFloat(getComputedStyle(c).paddingTop) - current.current;
      const next = alignedOffset({
        showcaseTop: s.getBoundingClientRect().top,
        headingTop: c.getBoundingClientRect().top + padding,
        spare: f.getBoundingClientRect().height,
        overflow: scroller ? scroller.scrollHeight - scroller.clientHeight : 0,
        offset: current.current,
      });
      if (next !== current.current) {
        current.current = next;
        setOffset(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    const scroller = column.current && scrollerOf(column.current);
    for (const el of [showcase.current, column.current?.parentElement, scroller]) if (el) observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { showcase, column, filler, offset };
}

/** The nearest ancestor that scrolls, if any. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}
