import { useState, type KeyboardEvent } from "react";
import type { ViewMode } from "../lib/viewModels";
import { BackIcon, FolderIcon, ForwardIcon, GridIcon, ListIcon, PlusIcon, ThemeIcon, UpIcon } from "./icons";

export type Theme = "Light" | "Dark";

/** Room for the native macOS window buttons, which sit over the toolbar. */
const IS_MAC = navigator.userAgent.includes("Mac");

export interface ToolbarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  crumbs: { label: string; path: string }[];
  onCrumb: (path: string) => void;
  /** Crumb that items being dragged would be dropped on. */
  dropTarget: string | null;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  /** Whether folders without a queue inside them are shown. */
  showAllFolders: boolean;
  onToggleFolders: () => void;
  onToggleAdd: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const nav = (enabled: boolean) => ({ className: "icon-btn", style: { color: enabled ? "var(--ink)" : "var(--track)" } });
  return (
    <div className="toolbar" data-tauri-drag-region>
      {IS_MAC && <div className="traffic-light-space" data-tauri-drag-region />}
      <div className="nav-buttons">
        <button {...nav(p.canBack)} title="Back" onClick={p.onBack}>
          <BackIcon />
        </button>
        <button {...nav(p.canForward)} title="Forward" onClick={p.onForward}>
          <ForwardIcon />
        </button>
        <button {...nav(p.canUp)} title="Enclosing folder" onClick={p.onUp}>
          <UpIcon />
        </button>
      </div>
      <div className="crumbs">
        {p.crumbs.map((c, i) => {
          const last = i === p.crumbs.length - 1;
          return (
            <span key={c.path} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">/</span>}
              <button
                className={"crumb" + (p.dropTarget === c.path ? " drop-target" : "")}
                data-drop={c.path}
                style={{ color: last ? "var(--ink)" : "var(--muted)", fontWeight: last ? 600 : 400 }}
                onClick={() => p.onCrumb(c.path)}
              >
                {c.label}
              </button>
            </span>
          );
        })}
      </div>
      <button
        className={"square-btn" + (p.showAllFolders ? "" : " toggled")}
        title={p.showAllFolders ? "Hide folders without downloads" : "Show all folders"}
        aria-pressed={!p.showAllFolders}
        onClick={p.onToggleFolders}
      >
        <FolderIcon />
      </button>
      <div className="segmented">
        {(["Icons", "List"] as const).map((m) => (
          <button
            key={m}
            title={m}
            className={p.mode === m ? "active" : ""}
            onClick={() => p.onMode(m)}
          >
            {m === "Icons" ? <GridIcon /> : <ListIcon />}
          </button>
        ))}
      </div>
      <button className="primary-btn" onClick={p.onToggleAdd}>
        <PlusIcon />
        Add link
      </button>
      <button
        className="square-btn"
        title={p.theme === "Dark" ? "Light mode" : "Dark mode"}
        onClick={p.onToggleTheme}
      >
        <ThemeIcon />
      </button>
    </div>
  );
}

/** A one-line input under the toolbar: a link to download, or a new queue's name. */
export function InputBar({
  label,
  dirLabel,
  placeholder,
  submitLabel,
  mono,
  onSubmit,
  onClose,
}: {
  label: string;
  dirLabel: string;
  placeholder: string;
  submitLabel: string;
  mono?: boolean;
  /** Rejects with a message to show next to the input. */
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="add-bar">
      <span className="add-label">
        {label} <span className="mono ink">{dirLabel}/</span>
      </span>
      <div className="add-input-wrap">
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={(mono ? "mono-input" : "") + (error ? " invalid" : "")}
        />
        {error && <span className="add-error">{error}</span>}
      </div>
      <button className="plain-btn" onClick={submit}>
        {submitLabel}
      </button>
    </div>
  );
}

/** Asks whether to add the links found on the clipboard. Enter adds, Escape cancels. */
export function PasteBar({
  urls,
  dirLabel,
  onAdd,
  onClose,
}: {
  urls: string[];
  dirLabel: string;
  /** Adds the links; `always` skips this prompt from now on. Rejects with a message to show. */
  onAdd: (always: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [always, setAlways] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    try {
      await onAdd(always);
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="add-bar">
      <span className="add-label">
        Add {urls.length === 1 ? "link" : `${urls.length} links`} to <span className="mono ink">{dirLabel}/</span>
      </span>
      <span className="paste-urls mono ellipsis" title={urls.join("\n")}>
        {urls[0]}
        {urls.length > 1 && <span className="muted"> and {urls.length - 1} more</span>}
      </span>
      {error && (
        <span className="status-warning ellipsis" title={error}>
          {error}
        </span>
      )}
      <label className="paste-always">
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
        Don't ask again
      </label>
      <button className="plain-btn" onClick={onClose}>
        Cancel
      </button>
      <button className="plain-btn" autoFocus onClick={add}>
        Add to queue
      </button>
    </div>
  );
}

export function StatusBar({
  itemCount,
  selInfo,
  left,
  speed,
  warning,
  notice,
}: {
  itemCount: string;
  selInfo: string;
  left: string;
  speed: string;
  warning: string | null;
  /** A passing message, such as why a move failed. */
  notice: string | null;
}) {
  return (
    <div className="status-bar">
      <span>{itemCount}</span>
      <span className="mono ellipsis">{selInfo}</span>
      <div className="spacer" />
      {notice && (
        <span className="status-warning ellipsis" title={notice}>
          {notice}
        </span>
      )}
      {warning && (
        <span className="status-warning" title={warning}>
          Couldn't save queues
        </span>
      )}
      <span>{left}</span>
      <span className="mono ink">{speed}</span>
    </div>
  );
}
