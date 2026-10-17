import { useRef, useState, type PointerEvent } from "react";
import { SORT_LABELS, type SortKey } from "../lib/sort";
import { CloseIcon, GripIcon } from "./icons";

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * The settings dialog, centred over the app, with settings that apply
 * everywhere, in sections. For now only the sort order: files are sorted by the
 * top key, then the next for ties. Closes on a click outside it (or Escape, in App).
 */
export function Settings({
  sortOrder,
  onSortOrder,
  onClose,
}: {
  sortOrder: SortKey[];
  onSortOrder: (order: SortKey[]) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="settings-backdrop"
      // Only a press on the backdrop itself, not one that started a drag inside.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-head">
          <span className="settings-title">Settings</span>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-heading">Sort files by</h3>
            <SortList order={sortOrder} onChange={onSortOrder} />
            <p className="settings-note">
              Sorted by the first, then by the next where they're equal. Drag to reorder, or click one to put it
              first. This doesn't change the order downloads run in.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Reorderable list: drag a row up or down, or click it to move it to the top. */
function SortList({ order, onChange }: { order: SortKey[]; onChange: (order: SortKey[]) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  // The press being tracked: which key, where it started, and whether it became a drag.
  const press = useRef<{ key: SortKey; y: number; dragging: boolean } | null>(null);
  const [dragging, setDragging] = useState<SortKey | null>(null);

  /** The index the pointer at `y` is over, from the rows' positions. */
  const indexAt = (y: number) => {
    const rows = [...(listRef.current?.children ?? [])];
    const i = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? rows.length - 1 : i;
  };

  const moveTo = (key: SortKey, index: number) => {
    const rest = order.filter((k) => k !== key);
    const next = [...rest.slice(0, index), key, ...rest.slice(index)];
    if (next.some((k, i) => k !== order[i])) onChange(next);
  };

  const onPointerDown = (key: SortKey, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { key, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.dragging) {
      p.dragging = true;
      setDragging(p.key);
    }
    moveTo(p.key, indexAt(e.clientY));
  };
  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    setDragging(null);
    if (p && !p.dragging) moveTo(p.key, 0);
  };

  return (
    <ol className="sort-list" ref={listRef}>
      {order.map((key, i) => (
        <li
          key={key}
          className={"sort-row" + (dragging === key ? " dragging" : "")}
          title={i === 0 ? "Sorted by this first" : "Click to sort by this first"}
          onPointerDown={(e) => onPointerDown(key, e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sort-rank">{i + 1}</span>
          <span className="sort-label">{SORT_LABELS[key]}</span>
          <GripIcon />
        </li>
      ))}
    </ol>
  );
}
