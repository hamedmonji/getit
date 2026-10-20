import { useRef, useState, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { clickSelect, nameCell, selectAllState, sizeCell, tickTargets } from "../lib/batch";
import type { LinkInfo } from "../lib/engine";

// How far the pointer moves before a press on a row becomes a drag.
const DRAG_THRESHOLD = 4;
// Dragging this close to the list's top or bottom scrolls it.
const SCROLL_EDGE = 28;

/**
 * Several pasted or captured links as a table of name, size and link, each
 * with a box to tick it. Click to select a row, Command-click to add or remove
 * one, Shift-click for a range; drag the selection to set the order they're
 * queued in. Ticking a selected row's box ticks the whole selection.
 */
export function LinkBatch({
  order,
  ticked,
  infos,
  onTick,
  onTickAll,
  onMove,
}: {
  /** The links, in the order they'll be queued. */
  order: string[];
  /** The links that will be added. */
  ticked: Set<string>;
  /** The server's answers: null where it couldn't say, missing while it's asked. */
  infos: Record<string, LinkInfo | null>;
  onTick: (urls: string[], ticked: boolean) => void;
  onTickAll: (ticked: boolean) => void;
  /** Moves links, keeping their order, to before the one at `index`, or to the end. */
  onMove: (urls: string[], index: number) => void;
}) {
  const rowsRef = useRef<HTMLOListElement>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  // The press being tracked, whether it became a drag, and whether a click
  // without dragging narrows the selection to its row, as in Finder.
  const press = useRef<{ url: string; y: number; dragging: boolean; collapse: boolean } | null>(null);
  /** Where the dragged row would go: before the row at this index, or at the end. */
  const [dropAt, setDropAt] = useState<number | null>(null);

  /** The drop index for the pointer at `y`, from the rows' positions. */
  const indexAt = (y: number) => {
    const rows = [...(rowsRef.current?.children ?? [])];
    const i = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? rows.length : i;
  };

  const onPointerDown = (url: string, e: PointerEvent) => {
    // The tick box handles its own presses.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    rowsRef.current?.setPointerCapture(e.pointerId);
    const toggle = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;
    press.current = { url, y: e.clientY, dragging: false, collapse: !toggle && !range && selection.has(url) };
    const next = clickSelect(order, selection, anchor.current, url, { toggle, range });
    anchor.current = next.anchor;
    setSelection(next.selection);
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.dragging = true;
    setDropAt(indexAt(e.clientY));
    const scroller = rowsRef.current?.parentElement;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (e.clientY < r.top + SCROLL_EDGE) scroller.scrollTop -= 8;
      else if (e.clientY > r.bottom - SCROLL_EDGE) scroller.scrollTop += 8;
    }
  };
  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    const at = dropAt;
    setDropAt(null);
    if (!p) return;
    if (!p.dragging) {
      if (p.collapse) setSelection(new Set([p.url]));
      return;
    }
    // A row dragged from outside the selection (Command-clicked off it) moves on its own.
    if (at !== null) onMove(selection.has(p.url) ? [...selection] : [p.url], at);
  };

  const all = selectAllState(order, ticked);
  return (
    <div className="link-batch">
      <div className="link-batch-header">
        <span />
        <Checkbox
          checked={all}
          onCheckedChange={() => onTickAll(all !== true)}
          aria-label={all === true ? "Deselect all" : "Select all"}
        />
        <span>Name</span>
        <span className="link-batch-size">Size</span>
        <span>Link</span>
      </div>
      <ol
        ref={rowsRef}
        className={"link-batch-rows" + (dropAt !== null ? " dragging" : "")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {order.map((url, i) => {
          const name = nameCell(url, infos[url]);
          const isTicked = ticked.has(url);
          return (
            <li
              key={url}
              className={
                "link-batch-row" +
                (isTicked ? "" : " unticked") +
                (selection.has(url) ? " selected" : "") +
                (dropAt === i ? " drop-before" : "") +
                (dropAt === order.length && i === order.length - 1 ? " drop-after" : "")
              }
              onPointerDown={(e) => onPointerDown(url, e)}
            >
              <GripVertical className="link-batch-grip" aria-hidden />
              <Checkbox
                checked={isTicked}
                onCheckedChange={(checked) => onTick(tickTargets(order, selection, url), checked === true)}
                aria-label={`Add ${name.fetching ? url : name.text}`}
              />
              <span className={"ellipsis link-batch-name" + (name.fetching ? " fetching" : "")} title={name.text}>
                {name.text}
              </span>
              <span className="link-batch-size muted">{sizeCell(infos[url])}</span>
              <span className="ellipsis mono muted link-batch-url" title={url}>
                {url}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
