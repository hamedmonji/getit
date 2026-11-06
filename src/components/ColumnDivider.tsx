import type { MouseEvent } from "react";
import { swallowClick } from "../hooks/useItemDrag";

/** How wide an element's text is laid out, past where it's cut off with an ellipsis. */
export function textWidth(el: Element): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width;
}

/**
 * The divider after a header cell: dragging it sizes that column, and
 * double-clicking fits the column to its widest text.
 */
export function ColumnDivider({
  label,
  onStart,
  onResize,
  onReset,
}: {
  label: string;
  onStart: () => void;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Not a press on the list, which would draw a selection box.
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = e.currentTarget.parentElement!.getBoundingClientRect().width;
    onStart();
    const root = document.documentElement;
    root.classList.add("col-resizing");
    const onMove = (m: globalThis.MouseEvent) => onResize(startWidth + m.clientX - startX);
    const onUp = () => {
      swallowClick();
      stop();
    };
    const stop = () => {
      root.classList.remove("col-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", stop);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", stop);
  };
  return (
    <div
      className="col-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
    />
  );
}
