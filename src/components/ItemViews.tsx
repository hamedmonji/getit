import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useColumnWidths } from "../hooks/useColumnWidths";
import { swallowClick } from "../hooks/useItemDrag";
import {
  COLUMN_LABELS,
  COLUMNS,
  columnTemplate,
  columnsWidth,
  pinName,
  resetColumn,
  resizeColumn,
} from "../lib/columns";
import { splitName } from "../lib/paths";
import type { FileVm, FolderVm } from "../lib/viewModels";
import { ActionButton, FileGlyph, FolderGlyph, ProgressBar } from "./Glyphs";

export interface ItemViewProps {
  folders: FolderVm[];
  files: FileVm[];
  /** Links being added that aren't downloads yet; shown dimmed, and can't be selected. */
  pending: FileVm[];
  /** Selected folder paths and download ids. */
  selected: Set<string>;
  /** Press on a folder (by path) or download (by id); may start a drag. */
  onItemMouseDown: (key: string, e: MouseEvent) => void;
  onItemClick: (key: string, e: MouseEvent) => void;
  onOpenFolder: (path: string) => void;
  onOpenFile: (vm: FileVm) => void;
  onAction: (vm: FileVm) => void;
  /** Folder (by path) or download (by id) whose name is being edited, if any. */
  editing: string | null;
  /** Commits a new name for a folder or download; rejects with a message if it can't be used. */
  onRename: (key: string, name: string) => Promise<void>;
  onCancelRename: () => void;
  /** Items being dragged, and the folder they'd be dropped on. */
  dragging: Set<string>;
  dropTarget: string | null;
  /** Items cut, waiting to be pasted somewhere else. */
  cut: Set<string>;
}

/** Inline name field, like Finder's: Enter or clicking away saves, Escape cancels. */
function NameEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = async () => {
    if (done.current) return;
    const name = value.trim();
    if (!name || name === initial) {
      done.current = true;
      onCancel();
      return;
    }
    try {
      done.current = true;
      await onCommit(name);
    } catch (e) {
      done.current = false;
      setError(String(e));
      ref.current?.focus();
    }
  };
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <input
      ref={ref}
      className={"name-editor" + (error ? " invalid" : "")}
      title={error ?? undefined}
      value={value}
      spellCheck={false}
      autoCorrect="off"
      onChange={(e) => {
        setValue(e.target.value);
        setError(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    />
  );
}

function FolderName({ props, path, name, className }: { props: ItemViewProps; path: string; name: string; className: string }) {
  if (props.editing === path) {
    return (
      <NameEditor
        initial={name}
        onCommit={(value) => props.onRename(path, value)}
        onCancel={props.onCancelRename}
      />
    );
  }
  return <span className={className}>{name}</span>;
}

/** A download's name, editable without its extension, which the file keeps. */
function FileName({ props, vm, className }: { props: ItemViewProps; vm: FileVm; className: string }) {
  if (props.editing === vm.id) {
    const [stem, ext] = splitName(vm.name);
    return (
      <NameEditor
        initial={stem}
        onCommit={(value) => props.onRename(vm.id, value + ext)}
        onCancel={props.onCancelRename}
      />
    );
  }
  return (
    <span className={className} style={{ color: vm.nameColor }}>
      {vm.name}
    </span>
  );
}

function handlers(props: ItemViewProps, key: string, open: () => void) {
  return {
    "data-key": key,
    onMouseDown: (e: MouseEvent) => props.onItemMouseDown(key, e),
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      props.onItemClick(key, e);
    },
    onDoubleClick: (e: MouseEvent) => {
      e.stopPropagation();
      open();
    },
  };
}

function stateClass(props: ItemViewProps, key: string) {
  return (
    (props.selected.has(key) ? " selected" : "") +
    (props.dropTarget === key ? " drop-target" : "") +
    (props.dragging.has(key) || props.cut.has(key) ? " dragging" : "")
  );
}

export function IconView(props: ItemViewProps) {
  return (
    <div className="icon-grid">
      {props.folders.map((g) => (
        <div
          key={g.path}
          data-drop={g.path}
          className={"tile" + stateClass(props, g.path)}
          {...handlers(props, g.path, () => props.onOpenFolder(g.path))}
        >
          <FolderGlyph vm={g} size="large" />
          <FolderName props={props} path={g.path} name={g.name} className="tile-name" />
          {g.showBar && <ProgressBar className="tile-bar" pct={g.pct} color={g.barColor} />}
          <div className="tile-sub">{g.sub}</div>
        </div>
      ))}
      {props.files.map((f) => (
        <div
          key={f.id}
          className={"tile" + stateClass(props, f.id)}
          {...handlers(props, f.id, () => props.onOpenFile(f))}
        >
          <ActionButton className="absolute top-1.5 right-1.5" vm={f} onAction={props.onAction} />
          <FileGlyph vm={f} size="large" />
          <FileName props={props} vm={f} className="tile-name clamp" />
          {f.showBar && <ProgressBar className="tile-bar" pct={f.pct} color={f.color} />}
          <div className="tile-sub ellipsis" title={f.status}>
            {f.status}
          </div>
        </div>
      ))}
      {props.pending.map((f) => (
        <div key={f.id} className="tile pending" title={f.info}>
          <FileGlyph vm={f} size="large" />
          <div className="tile-name clamp" style={{ color: f.nameColor }}>
            {f.name}
          </div>
          <div className="tile-sub ellipsis">{f.status}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The divider after a header cell: dragging it sizes that column, and
 * double-clicking puts the column back to its default width.
 */
function ColumnDivider({
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

export function ListView(props: ItemViewProps) {
  const [widths, setWidths] = useColumnWidths();
  const nameCell = useRef<HTMLDivElement>(null);
  const columns = {
    "--list-columns": columnTemplate(widths),
    "--list-columns-width": `${columnsWidth(widths)}px`,
  } as CSSProperties;
  return (
    <div className="list" style={columns}>
      <div className="list-header">
        {COLUMNS.map((key) => (
          <div key={key} ref={key === "name" ? nameCell : undefined} className="list-column">
            <div className="ellipsis">{COLUMN_LABELS[key]}</div>
            <ColumnDivider
              label={COLUMN_LABELS[key]}
              onStart={() => setWidths((w) => pinName(w, nameCell.current!.getBoundingClientRect().width))}
              onResize={(width) => setWidths((w) => resizeColumn(w, key, width))}
              onReset={() => setWidths((w) => resetColumn(w, key))}
            />
          </div>
        ))}
        <span />
      </div>
      <div className="list-rows">
        {props.folders.map((g) => (
          <div
            key={g.path}
            data-drop={g.path}
            className={"row folder-row" + stateClass(props, g.path)}
            {...handlers(props, g.path, () => props.onOpenFolder(g.path))}
          >
            <FolderGlyph vm={g} size="small" />
            <FolderName props={props} path={g.path} name={g.name} className="row-name" />
            <span className="row-sub">{g.sub}</span>
            <ProgressBar className="row-bar" pct={g.pct} color={g.barColor} />
            <span className="row-size">{g.sizeLabel}</span>
            <span />
          </div>
        ))}
        {props.files.map((f) => (
          <div
            key={f.id}
            className={"row file-row" + stateClass(props, f.id)}
            {...handlers(props, f.id, () => props.onOpenFile(f))}
          >
            <FileGlyph vm={f} size="small" />
            <FileName props={props} vm={f} className="row-name" />
            <span className="row-status" title={f.status}>
              {f.status}
            </span>
            <ProgressBar className="row-bar" pct={f.pct} color={f.color} />
            <span className="row-size">{f.sizeLabel}</span>
            <div className="row-actions">
              <ActionButton vm={f} onAction={props.onAction} />
            </div>
          </div>
        ))}
        {props.pending.map((f) => (
          <div key={f.id} className="row file-row pending" title={f.info}>
            <FileGlyph vm={f} size="small" />
            <span className="row-name" style={{ color: f.nameColor }}>
              {f.name}
            </span>
            <span className="row-status">{f.status}</span>
            <span />
            <span className="row-size">{f.sizeLabel}</span>
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
