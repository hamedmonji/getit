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
                className="crumb"
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

export function AddBar({
  dirLabel,
  onAdd,
  onClose,
}: {
  dirLabel: string;
  onAdd: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const raw = url.trim();
    if (!raw) return;
    const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
    try {
      await onAdd(full);
      setUrl("");
      setError(null);
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
        Download into <span className="mono ink">{dirLabel}/</span>
      </span>
      <div className="add-input-wrap">
        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          placeholder="https://…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={error ? "invalid" : ""}
        />
        {error && <span className="add-error">{error}</span>}
      </div>
      <button className="plain-btn" onClick={submit}>
        Add to queue
      </button>
    </div>
  );
}

export interface QueueBarProps {
  summary: string;
  pct: number;
  maxConcurrent: number;
  paused: boolean;
  onConcurrency: (n: number) => void;
  onTogglePause: () => void;
  onClearDone: () => void;
}

export const MAX_CONCURRENCY = 6;

export function QueueBar(p: QueueBarProps) {
  return (
    <div className="queue-bar">
      <span className="queue-label">Queue</span>
      <span>{p.summary}</span>
      <div className="spacer" />
      <div className="stepper">
        <button onClick={() => p.onConcurrency(Math.max(1, p.maxConcurrent - 1))}>−</button>
        <span>{p.maxConcurrent} at a time</span>
        <button onClick={() => p.onConcurrency(Math.min(MAX_CONCURRENCY, p.maxConcurrent + 1))}>+</button>
      </div>
      <button className="small-btn" onClick={p.onTogglePause}>
        {p.paused ? "Resume queue" : "Pause queue"}
      </button>
      <button className="small-btn" onClick={p.onClearDone}>
        Clear done
      </button>
      <div className="queue-progress">
        <div style={{ width: p.pct + "%" }} />
      </div>
    </div>
  );
}

export function StatusBar({
  itemCount,
  selInfo,
  left,
  speed,
  warning,
}: {
  itemCount: string;
  selInfo: string;
  left: string;
  speed: string;
  warning: string | null;
}) {
  return (
    <div className="status-bar">
      <span>{itemCount}</span>
      <span className="mono ellipsis">{selInfo}</span>
      <div className="spacer" />
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
