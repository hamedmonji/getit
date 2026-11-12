import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useColumnWidths } from "../hooks/useColumnWidths";
import { useListFiller } from "../hooks/useListFiller";
import { useMiddleEllipsis } from "../hooks/useMiddleEllipsis";
import { useStoredJson } from "../hooks/useStoredJson";
import {
  COLUMN_LABELS,
  COLUMNS,
  columnTemplate,
  columnsWidth,
  FIT_SELECTORS,
  fitColumn,
  parseHiddenColumns,
  pinName,
  resizeColumn,
  shownColumns,
  withColumnShown,
  type ColumnKey,
} from "../lib/columns";
import { formatAdded } from "../lib/format";
import { splitName } from "../lib/paths";
import type { FileVm, FolderVm } from "../lib/viewModels";
import { fillerStripes } from "../lib/listFiller";
import { ActionButton, FileGlyph, FolderGlyph, ProgressBar } from "./Glyphs";
import { ColumnDivider, textWidth } from "./ColumnDivider";

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

function FolderName({
  props,
  path,
  name,
  className,
  children,
}: {
  props: ItemViewProps;
  path: string;
  name: string;
  className?: string;
  /** Shown instead of a plain name while it isn't being edited. */
  children?: ReactNode;
}) {
  if (props.editing === path) {
    return (
      <NameEditor
        initial={name}
        onCommit={(value) => props.onRename(path, value)}
        onCancel={props.onCancelRename}
      />
    );
  }
  return children ?? <span className={className}>{name}</span>;
}

/** A folder's name on a tile: at most two lines, shortened in the middle past that. */
function TileFolderLabel({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useMiddleEllipsis(ref, name);
  return (
    <span ref={ref} className="tile-name two-lines" title={shown === name ? undefined : name}>
      {shown}
    </span>
  );
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
          <FolderName props={props} path={g.path} name={g.name}>
            <TileFolderLabel name={g.name} />
          </FolderName>
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
          {/* Finished files open on a double-click; the tile stays clear of a reveal button. */}
          {f.action !== "reveal" && (
            <ActionButton className="absolute top-1.5 right-1.5" vm={f} onAction={props.onAction} />
          )}
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
 * The list: a header of resizable columns over the rows. Right-clicking the
 * header lists the columns to show or hide; the name column always shows.
 */
export function ListView(props: ItemViewProps) {
  const [widths, setWidths] = useColumnWidths();
  const [hidden, setHidden] = useStoredJson("getit.hiddenColumns", parseHiddenColumns);
  const shown = shownColumns(hidden);
  const nameCell = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * Fits column `key` to its widest text: its header's and its rows'. The name
   * column is fixed at its width first, as for a drag, so fitting another
   * column doesn't take room from it.
   */
  const fit = (key: ColumnKey) => {
    const list = listRef.current;
    const selector = FIT_SELECTORS[key];
    if (!list || !nameCell.current) return;
    const header = list.querySelector(`[data-column="${key}"] .ellipsis`);
    const texts = selector ? [header, ...(list.querySelector(".list-rows")?.querySelectorAll(selector) ?? [])] : [];
    const measured = texts.filter((el): el is Element => !!el).map(textWidth);
    const nameWidth = nameCell.current.getBoundingClientRect().width;
    setWidths((w) => fitColumn(pinName(w, nameWidth), key, measured));
  };
  const columns = {
    "--list-columns": columnTemplate(widths, shown),
    "--list-columns-width": `${columnsWidth(widths, shown)}px`,
  } as CSSProperties;
  /** A row's cells for the shown columns, in their order. */
  const cells = (row: Record<ColumnKey, ReactNode>) => shown.map((key) => <Fragment key={key}>{row[key]}</Fragment>);
  const now = Date.now();
  const added = (f: FileVm) => <span className="row-added">{formatAdded(f.addedAt, now)}</span>;
  const rowsRef = useRef<HTMLDivElement>(null);
  const space = useListFiller(rowsRef);
  const filler = fillerStripes(space.realRows, space.room, space.rowHeight);
  return (
    <div ref={listRef} className="list" style={columns}>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <div
            className="list-header"
            // Not the folder's menu, which the content area opens on a right-click.
            onContextMenu={(e) => e.stopPropagation()}
          >
            {shown.map((key) => (
              <div key={key} ref={key === "name" ? nameCell : undefined} className="list-column" data-column={key}>
                <div className="ellipsis">{COLUMN_LABELS[key]}</div>
                <ColumnDivider
                  label={COLUMN_LABELS[key]}
                  onStart={() => setWidths((w) => pinName(w, nameCell.current!.getBoundingClientRect().width))}
                  onResize={(width) => setWidths((w) => resizeColumn(w, key, width))}
                  onReset={() => fit(key)}
                />
              </div>
            ))}
            <span />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {/* The name column always shows, so it isn't offered. */}
          {COLUMNS.filter((key) => key !== "name").map((key) => (
            <ContextMenuCheckboxItem
              key={key}
              checked={shown.includes(key)}
              // Stays open, to tick more than one.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => setHidden((h) => withColumnShown(h, key, checked))}
            >
              {COLUMN_LABELS[key]}
            </ContextMenuCheckboxItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <div ref={rowsRef} className="list-rows">
        {props.folders.map((g) => (
          <div
            key={g.path}
            data-drop={g.path}
            className={"row folder-row" + stateClass(props, g.path)}
            {...handlers(props, g.path, () => props.onOpenFolder(g.path))}
          >
            <span />
            <FolderGlyph vm={g} size="small" />
            {cells({
              name: <FolderName props={props} path={g.path} name={g.name} className="row-name" />,
              status: <span className="row-sub">{g.sub}</span>,
              progress: <ProgressBar className="row-bar" pct={g.pct} color={g.barColor} />,
              size: <span className="row-size">{g.sizeLabel}</span>,
              added: <span />,
            })}
            <span />
          </div>
        ))}
        {props.files.map((f) => (
          <div
            key={f.id}
            className={"row file-row" + stateClass(props, f.id)}
            {...handlers(props, f.id, () => props.onOpenFile(f))}
          >
            <div className="row-actions">
              <ActionButton vm={f} onAction={props.onAction} />
            </div>
            <FileGlyph vm={f} size="small" />
            {cells({
              name: <FileName props={props} vm={f} className="row-name" />,
              status: (
                <span className="row-status" title={f.status}>
                  {f.status}
                </span>
              ),
              // A file that isn't a download has no progress to show.
              progress: f.plain ? <span /> : <ProgressBar className="row-bar" pct={f.pct} color={f.color} />,
              size: <span className="row-size">{f.sizeLabel}</span>,
              added: added(f),
            })}
            <span />
          </div>
        ))}
        {props.pending.map((f) => (
          <div key={f.id} className="row file-row pending" title={f.info}>
            <span />
            <FileGlyph vm={f} size="small" />
            {cells({
              name: (
                <span className="row-name" style={{ color: f.nameColor }}>
                  {f.name}
                </span>
              ),
              status: <span className="row-status">{f.status}</span>,
              progress: <span />,
              size: <span className="row-size">{f.sizeLabel}</span>,
              added: added(f),
            })}
            <span />
          </div>
        ))}
        {/* Carries alternate row colours on to the bottom of the view. */}
        {filler.length > 0 && (
          <div className="list-filler" aria-hidden style={{ height: space.room }}>
            {filler.map((striped, i) => (
              <div key={i} className={striped ? "filler-row striped" : "filler-row"} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
