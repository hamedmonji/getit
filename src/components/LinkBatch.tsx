import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Copy, GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { clickSelect, indexInOrder, nameCell, selectAllState, sizeCell, tickTargets } from "../lib/batch";
import type { ChoiceOption, DupChoice, DupView } from "../lib/batchDuplicates";
import type { LinkInfo } from "../lib/engine";

// How far the pointer moves before a press on a row becomes a drag.
const DRAG_THRESHOLD = 4;
// Dragging this close to the list's top or bottom scrolls it.
const SCROLL_EDGE = 28;

/** A segmented control for a duplicate's choice: skip, keep both or replace. */
function ChoiceControl({
  options,
  value,
  onChoose,
}: {
  options: ChoiceOption[];
  value: DupChoice | null;
  onChoose: (choice: DupChoice) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={0.5}
      size="sm"
      className="dup-choice"
      value={value ?? ""}
      // Choosing the chosen one again keeps it.
      onValueChange={(v) => v && onChoose(v as DupChoice)}
      onPointerDown={(e) => e.stopPropagation()}
      // Focusing a button on press can scroll the list under the pointer, so
      // the release misses it; the keyboard still reaches them with Tab.
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.choice} value={o.choice} title={o.title} className="dup-choice-item">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Several pasted or captured links as a table of name, size and link, each
 * with a box to tick it. Click to select a row, Command-click to add or remove
 * one, Shift-click for a range; drag the selection to set the order they're
 * queued in. Ticking a selected row's box ticks the whole selection.
 *
 * Links that already exist (`duplicates`) are listed first under a header
 * that chooses for all of them, each with where it is and its own choice.
 * They're added before the others, so they don't move.
 */
export function LinkBatch({
  order,
  ticked,
  infos,
  duplicates = null,
  onTick,
  onTickAll,
  onMove,
  onChoose,
}: {
  /** The links, in the order they'll be queued. */
  order: string[];
  /** The links that will be added. */
  ticked: Set<string>;
  /** The server's answers: null where it couldn't say, missing while it's asked. */
  infos: Record<string, LinkInfo | null>;
  duplicates?: DupView | null;
  onTick: (urls: string[], ticked: boolean) => void;
  onTickAll: (ticked: boolean) => void;
  /** Moves links, keeping their order, to before the one at `index`, or to the end. */
  onMove: (urls: string[], index: number) => void;
  onChoose?: (urls: string[], choice: DupChoice) => void;
}) {
  const rowsRef = useRef<HTMLOListElement>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  // The press being tracked, whether it became a drag, and whether a click
  // without dragging narrows the selection to its row, as in Finder.
  const press = useRef<{ url: string; y: number; dragging: boolean; collapse: boolean; drags: boolean } | null>(null);
  /** Where the dragged rows would go: before the movable row at this index, or at the end. */
  const [dropAt, setDropAt] = useState<number | null>(null);

  const dups = duplicates ? order.filter((u) => u in duplicates.rows) : [];
  const rest = duplicates ? order.filter((u) => !(u in duplicates.rows)) : order;
  // The rows as they show, for selecting ranges and ticking the selection.
  const shown = [...dups, ...rest];

  /** The drop index among the movable rows for the pointer at `y`, from their positions. */
  const indexAt = (y: number) => {
    const rows = [...(rowsRef.current?.children ?? [])];
    const i = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? rows.length : i;
  };

  const onPointerDown = (url: string, e: PointerEvent) => {
    // The tick box and the choice buttons handle their own presses.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    rowsRef.current?.setPointerCapture(e.pointerId);
    const toggle = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;
    const drags = rest.includes(url);
    press.current = { url, y: e.clientY, dragging: false, collapse: !toggle && !range && selection.has(url), drags };
    const next = clickSelect(shown, selection, anchor.current, url, { toggle, range });
    anchor.current = next.anchor;
    setSelection(next.selection);
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p || !p.drags) return;
    if (!p.dragging && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.dragging = true;
    setDropAt(indexAt(e.clientY));
    const scroller = rowsRef.current?.closest(".link-batch");
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
    // A row dragged from outside the selection (Command-clicked off it) moves
    // on its own; selected duplicates stay where they are.
    const moving = (selection.has(p.url) ? rest.filter((u) => selection.has(u)) : [p.url]);
    if (at !== null) onMove(moving, indexInOrder(order, rest, at));
  };

  /** One link's row: grip, tick box, name, size and link; `under` goes below it. */
  const row = (url: string, i: number | null, under?: ReactNode) => {
    const name = nameCell(url, infos[url]);
    const isTicked = ticked.has(url);
    const movable = i !== null;
    return (
      <li
        key={url}
        className={
          "link-batch-row" +
          (movable ? "" : " fixed") +
          (isTicked ? "" : " unticked") +
          (selection.has(url) ? " selected" : "") +
          (movable && dropAt === i ? " drop-before" : "") +
          (movable && dropAt === rest.length && i === rest.length - 1 ? " drop-after" : "")
        }
        onPointerDown={(e) => onPointerDown(url, e)}
      >
        <div className="link-batch-cells">
          <GripVertical className="link-batch-grip" aria-hidden />
          <Checkbox
            checked={isTicked}
            onCheckedChange={(checked) => onTick(tickTargets(shown, selection, url), checked === true)}
            aria-label={`Add ${name.fetching ? url : name.text}`}
          />
          <span className={"ellipsis link-batch-name" + (name.fetching ? " fetching" : "")} title={name.text}>
            {name.text}
          </span>
          <span className="link-batch-size muted">{sizeCell(infos[url])}</span>
          <span className="ellipsis mono muted link-batch-url" title={url}>
            {url}
          </span>
        </div>
        {under}
      </li>
    );
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
      <div className="link-batch-body" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {duplicates && dups.length > 0 && (
          <>
            <div className="dup-group-head">
              <Copy className="dup-icon" aria-hidden />
              <span className="dup-group-text">{duplicates.heading}</span>
              <ChoiceControl
                options={duplicates.options}
                value={duplicates.choice}
                onChoose={(choice) => onChoose?.(dups, choice)}
              />
            </div>
            <ul className="link-batch-rows">
              {dups.map((url) => {
                const d = duplicates.rows[url];
                return row(
                  url,
                  null,
                  <div className="dup-line">
                    <Copy className="dup-icon" aria-hidden />
                    <span className="dup-line-text">{d.text}</span>
                    <ChoiceControl options={d.options} value={d.choice} onChoose={(choice) => onChoose?.([url], choice)} />
                  </div>,
                );
              })}
            </ul>
            {rest.length > 0 && <div className="dup-separator" />}
          </>
        )}
        <ol ref={rowsRef} className={"link-batch-rows" + (dropAt !== null ? " dragging" : "")}>
          {rest.map((url, i) => row(url, i))}
        </ol>
      </div>
    </div>
  );
}
