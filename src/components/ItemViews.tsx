import type { MouseEvent } from "react";
import type { FileVm, FolderVm } from "../lib/viewModels";
import { ActionButton, FileGlyph, FolderGlyph, ProgressBar } from "./Glyphs";

export interface ItemViewProps {
  folders: FolderVm[];
  files: FileVm[];
  /** Selected folder path or download id. */
  selected: string | null;
  onSelect: (key: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenFile: (vm: FileVm) => void;
  onAction: (vm: FileVm) => void;
}

function handlers(props: ItemViewProps, key: string, open: () => void) {
  return {
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      props.onSelect(key);
    },
    onDoubleClick: (e: MouseEvent) => {
      e.stopPropagation();
      open();
    },
  };
}

function selectedClass(props: ItemViewProps, key: string) {
  return props.selected === key ? " selected" : "";
}

export function IconView(props: ItemViewProps) {
  return (
    <div className="icon-grid">
      {props.folders.map((g) => (
        <div
          key={g.path}
          className={"tile" + selectedClass(props, g.path)}
          {...handlers(props, g.path, () => props.onOpenFolder(g.path))}
        >
          <FolderGlyph vm={g} size="large" />
          <div className="tile-name">{g.name}</div>
          {g.showBar && <ProgressBar className="tile-bar" pct={g.pct} color={g.barColor} />}
          <div className="tile-sub">{g.sub}</div>
        </div>
      ))}
      {props.files.map((f) => (
        <div
          key={f.id}
          className={"tile" + selectedClass(props, f.id)}
          {...handlers(props, f.id, () => props.onOpenFile(f))}
        >
          <ActionButton className="tile-action" vm={f} onAction={props.onAction} />
          <FileGlyph vm={f} size="large" />
          <div className="tile-name clamp" style={{ color: f.nameColor }}>
            {f.name}
          </div>
          {f.showBar && <ProgressBar className="tile-bar" pct={f.pct} color={f.color} />}
          <div className="tile-sub ellipsis" title={f.status}>
            {f.status}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListView(props: ItemViewProps) {
  return (
    <div className="list">
      <div className="list-header">
        <span>Name</span>
        <span>Status</span>
        <span className="right">Size</span>
        <span>Progress</span>
        <span />
      </div>
      <div className="list-rows">
        {props.folders.map((g) => (
          <div
            key={g.path}
            className={"row folder-row" + selectedClass(props, g.path)}
            {...handlers(props, g.path, () => props.onOpenFolder(g.path))}
          >
            <FolderGlyph vm={g} size="small" />
            <span className="row-name">{g.name}</span>
            <span className="row-sub">{g.sub}</span>
            <span className="row-size">{g.sizeLabel}</span>
            <ProgressBar className="row-bar" pct={g.pct} color={g.barColor} />
            <span />
          </div>
        ))}
        {props.files.map((f) => (
          <div
            key={f.id}
            className={"row file-row" + selectedClass(props, f.id)}
            {...handlers(props, f.id, () => props.onOpenFile(f))}
          >
            <FileGlyph vm={f} size="small" />
            <span className="row-name" style={{ color: f.nameColor }}>
              {f.name}
            </span>
            <span className="row-status" title={f.status}>
              {f.status}
            </span>
            <span className="row-size">{f.sizeLabel}</span>
            <ProgressBar className="row-bar" pct={f.pct} color={f.color} />
            <div className="row-actions">
              <ActionButton className="row-action" vm={f} onAction={props.onAction} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
