import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * How much room the list view's scrolling area has below its last row, and
 * how tall a filler row is, measured from `rows` (the list's rows) whenever it
 * or the area changes size. Leaves out the filler itself, in `.list-filler`.
 */
export function useListFiller(rows: RefObject<HTMLElement | null>) {
  const [space, setSpace] = useState({ room: 0, rowHeight: 0, realRows: 0 });
  useLayoutEffect(() => {
    const list = rows.current;
    const area = list?.closest<HTMLElement>(".content");
    if (!list || !area) return;
    const measure = () => {
      const style = getComputedStyle(list);
      const real = [...list.children].filter((child) => !child.classList.contains("list-filler"));
      const last = real[real.length - 1];
      const top = last ? last.getBoundingClientRect().bottom : list.getBoundingClientRect().top + parseFloat(style.paddingTop);
      const bottom = area.getBoundingClientRect().top + area.clientHeight - parseFloat(style.paddingBottom);
      const next = {
        room: Math.max(0, Math.floor(bottom - top)),
        rowHeight: parseFloat(style.getPropertyValue("--file-row-h")) || 0,
        realRows: real.length,
      };
      setSpace((s) => (s.room === next.room && s.rowHeight === next.rowHeight && s.realRows === next.realRows ? s : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(list);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rows]);
  return space;
}
