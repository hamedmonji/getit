import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DownloadItem, QueueSettings as Settings } from "../lib/engine";
import type { FileVm } from "../lib/viewModels";
import { FileGlyph } from "./Glyphs";
import { CloseIcon, FolderIcon } from "./icons";
import { QueueSettingsForm } from "./QueueSettingsForm";

type Tab = "settings" | "order";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "settings", label: "Settings" },
  { tab: "order", label: "Queue Order" },
];

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_THRESHOLD = 4;
/** How close to the list's top or bottom edge a drag scrolls it. */
const SCROLL_EDGE = 28;

/**
 * The side panel for the selected queue folder's queue, or else the
 * current folder's, with a tab for its settings and one for the
 * order its downloads run in. It follows the selection and the folder you're in.
 */
export function QueueSettings({
  queue,
  files,
  items,
  onSettings,
  onRename,
  onReorder,
  onClose,
}: {
  /** The queue to show, or null if there's none to show. */
  queue: { id: string; name: string; path: string; settings: Settings } | null;
  /** The queue's unfinished downloads, in queue order. */
  items: DownloadItem[];
  /** Saves the queue's settings. */
  onSettings: (settings: Settings) => void;
  /** Renames downloads already in the queue. */
  onRename: (renames: { id: string; name: string }[]) => void;
  /** The queue's unfinished downloads, in queue order. */
  files: FileVm[];
  /** Puts these downloads first, in this order; finished ones follow. */
  onReorder: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("settings");
  // Each queue's limit before it went unlimited, to go back to.
  const limits = useRef(new Map<string, number>());
  return (
    <aside className="overview queue-settings-panel" aria-label="Queue settings">
      <div className="overview-head">
        {queue && <div className="queue-settings-folder" title={queue.path}>
          <FolderIcon />
          <span className="ellipsis">{queue.name}</span>
        </div>
        }
        <span className="overview-total" />
        <Button variant="ghost" size="icon-sm" className="text-ink-muted" title="Close" onClick={onClose}>
          <CloseIcon />
        </Button>
      </div>
      {queue ? (
        <Tabs value={tab} onValueChange={(t) => setTab(t as Tab)} className="min-h-0 flex-1 gap-0">
          <div className="panel-tabs">
            <TabsList className="w-full">
              {TABS.map(({ tab: t, label }) => (
                <TabsTrigger key={t} value={t}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="settings" className="flex min-h-0 flex-col">
            {/* Keyed so rules being edited don't carry over to another queue. */}
            <QueueSettingsForm
              key={queue.id}
              settings={queue.settings}
              items={items}
              rememberedLimit={limits.current.get(queue.id)}
              onChange={onSettings}
              onRememberLimit={(limit) => limits.current.set(queue.id, limit)}
              onRename={onRename}
            />
          </TabsContent>
          <TabsContent value="order" className="flex min-h-0 flex-col">
            {/* Keyed so each queue has its own selection. */}
            <QueueOrder key={queue.id} files={files} onReorder={onReorder} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="overview-body">
          <div className="overview-empty">This folder has no queue. Add a download here to start one.</div>
        </div>
      )}
    </aside>
  );
}

/**
 * The queue's unfinished downloads in the order they run. Click to select,
 * Command-click to add or remove one, Shift-click for a range; drag the
 * selection to move it.
 */
function QueueOrder({ files, onReorder }: { files: FileVm[]; onReorder: (ids: string[]) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  // The press being tracked, and whether it became a drag.
  const press = useRef<{ id: string; y: number; dragging: boolean; collapse: boolean } | null>(null);
  /** Where the dragged rows would go: before the row at this index, or at the end. */
  const [dropAt, setDropAt] = useState<number | null>(null);
  // Shown until the queue reports its new order, so rows don't jump back meanwhile.
  const [pending, setPending] = useState<string[] | null>(null);

  const ids = files.map((f) => f.id);
  const idsKey = ids.join(",");
  useEffect(() => {
    setPending(null);
    // Forget downloads that left the queue.
    setSelected((sel) => {
      const kept = new Set([...sel].filter((id) => ids.includes(id)));
      return kept.size === sel.size ? sel : kept;
    });
  }, [idsKey]);

  const byId = new Map(files.map((f) => [f.id, f]));
  const shown = (pending ?? ids).map((id) => byId.get(id)).filter((f): f is FileVm => !!f);

  const select = (id: string, e: PointerEvent) => {
    const command = e.metaKey || e.ctrlKey;
    if (e.shiftKey && anchor.current) {
      const order = shown.map((f) => f.id);
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(id)].sort((x, y) => x - y);
      setSelected(new Set(order.slice(a, b + 1)));
      return;
    }
    anchor.current = id;
    if (command) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    } else if (!selected.has(id)) {
      setSelected(new Set([id]));
    }
  };

  /** The drop index for the pointer at `y`, from the rows' positions. */
  const indexAt = (y: number) => {
    const rows = [...(listRef.current?.children ?? [])];
    const i = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? rows.length : i;
  };

  const onPointerDown = (id: string, e: PointerEvent) => {
    if (e.button !== 0) return;
    listRef.current?.setPointerCapture(e.pointerId);
    // Pressing a selected row keeps the selection so it can be dragged; a plain
    // click without dragging then narrows it to that row, as in Finder.
    const plain = !(e.metaKey || e.ctrlKey || e.shiftKey);
    press.current = { id, y: e.clientY, dragging: false, collapse: plain && selected.has(id) };
    select(id, e);
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.dragging = true;
    setDropAt(indexAt(e.clientY));
    const scroller = listRef.current?.parentElement;
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
      if (p.collapse) setSelected(new Set([p.id]));
      return;
    }
    if (at === null) return;
    const order = shown.map((f) => f.id);
    const moving = order.filter((id) => selected.has(id));
    const before = order.slice(0, at).filter((id) => !selected.has(id));
    const after = order.slice(at).filter((id) => !selected.has(id));
    const next = [...before, ...moving, ...after];
    if (next.some((id, i) => id !== order[i])) {
      setPending(next);
      onReorder(next);
      // If the queue never reports it (the reorder failed), show its real order again.
      setTimeout(() => setPending((p) => (p === next ? null : p)), 2000);
    }
  };

  if (!files.length) {
    return (
      <div className="overview-body">
        <div className="overview-empty">Nothing left to download in this queue.</div>
      </div>
    );
  }
  return (
    <div className="overview-body">
      <ol
        ref={listRef}
        className={"queue-order-list" + (dropAt !== null ? " dragging" : "")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {shown.map((f, i) => (
          <li
            key={f.id}
            className={
              "queue-order-row" +
              (selected.has(f.id) ? " selected" : "") +
              (dropAt === i ? " drop-before" : "") +
              (dropAt === shown.length && i === shown.length - 1 ? " drop-after" : "")
            }
            title={f.info}
            onPointerDown={(e) => onPointerDown(f.id, e)}
          >
            <FileGlyph vm={f} size="small" />
            <span className="queue-order-text">
              <span className="queue-order-name ellipsis" style={{ color: f.nameColor }}>
                {f.name}
              </span>
              <span className="queue-order-status ellipsis">{f.status}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="settings-note queue-order-note">
        Multi/Select items and drag to reorder.
      </p>
    </div>
  );
}
