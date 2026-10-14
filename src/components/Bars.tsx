import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isPathLike } from "../lib/paths";
import type { ViewMode } from "../lib/viewModels";
import {
  BackIcon,
  CloseIcon,
  FolderIcon,
  ForwardIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  ThemeIcon,
  UpIcon,
} from "./icons";

export type Theme = "Light" | "Dark";

/** Room for the native macOS window buttons, which sit over the toolbar. */
const IS_MAC = navigator.userAgent.includes("Mac");
const MOD = IS_MAC ? "⌘" : "Ctrl+";

export interface ToolbarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  /** The current folder as shown to the user, such as `~/Movies`. */
  cwdLabel: string;
  /** The folders from home (or the root) down to the current one. */
  crumbs: { label: string; path: string }[];
  onCrumb: (path: string) => void;
  /** Folder in the path that items being dragged would be dropped on. */
  dropTarget: string | null;
  /** Whether the address bar is being typed in. */
  addressOpen: boolean;
  onAddressOpen: (open: boolean) => void;
  /** The search being shown; empty when browsing. */
  query: string;
  onQuery: (query: string) => void;
  /** Whether the search covers every queue rather than this folder; Tab switches. */
  searchAll: boolean;
  onSearchAll: (all: boolean) => void;
  /** Goes to a typed path; rejects with a message to show. */
  onGoTo: (raw: string) => Promise<void>;
  /** Moves from the search field to its results. */
  onSearchResults: () => void;
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
        <button {...nav(p.canBack)} title={`Back (${MOD}[)`} onClick={p.onBack}>
          <BackIcon />
        </button>
        <button {...nav(p.canForward)} title={`Forward (${MOD}])`} onClick={p.onForward}>
          <ForwardIcon />
        </button>
        <button {...nav(p.canUp)} title="Enclosing folder" onClick={p.onUp}>
          <UpIcon />
        </button>
      </div>
      <AddressBar {...p} />
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

/**
 * The current folder's path, which turns into a field when clicked: text starting with `/`
 * or `~` is a path to go to on Enter, anything else searches as it's typed.
 * The field stays while a search is shown.
 */
function AddressBar(p: ToolbarProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!p.addressOpen) return;
    if (!p.query) setText(p.cwdLabel);
    setError(null);
    input.current?.focus();
    input.current?.select();
  }, [p.addressOpen]);

  if (!p.addressOpen && !p.query) {
    // Reads as one line of text, but each parent folder can be clicked to go
    // there or dropped onto. The folder's name stays whole; its parents shrink
    // first when space runs out.
    const parents = p.crumbs.slice(0, -1);
    const current = p.crumbs[p.crumbs.length - 1];
    return (
      <div className="address-bar" title="Click to enter a path or search" onClick={() => p.onAddressOpen(true)}>
        {parents.length > 0 && (
          <span className="address-parent">
            {parents.map((c) => (
              <span key={c.path}>
                <span
                  className={"address-segment" + (p.dropTarget === c.path ? " drop-target" : "")}
                  data-drop={c.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onCrumb(c.path);
                  }}
                >
                  {c.label}
                </span>
                {c.label !== "/" && "/"}
              </span>
            ))}
          </span>
        )}
        <span className="address-name">{current.label}</span>
      </div>
    );
  }

  const close = () => {
    p.onQuery("");
    p.onAddressOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "Tab") {
      // Switches where to search, unless a path is being typed. The current
      // folder's path, as the field opens with, gives way to the search.
      e.preventDefault();
      if (isPathLike(text) && text !== p.cwdLabel) return;
      if (isPathLike(text)) setText("");
      p.onSearchAll(!p.searchAll);
    } else if (e.key === "Enter" && isPathLike(text)) {
      p.onGoTo(text).catch((err) => setError(String(err)));
    } else if ((e.key === "Enter" || e.key === "ArrowDown") && p.query) {
      e.preventDefault();
      input.current?.blur();
      p.onSearchResults();
    }
  };

  const typingPath = isPathLike(text) && text !== p.cwdLabel;
  return (
    <div className={"address-bar editing" + (error ? " invalid" : "")}>
      <span className="address-icon">{isPathLike(text) ? <FolderIcon size={13} /> : <SearchIcon />}</span>
      <input
        ref={input}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
          p.onQuery(isPathLike(e.target.value) ? "" : e.target.value.trim());
        }}
        onKeyDown={onKey}
        onFocus={() => p.onAddressOpen(true)}
        onBlur={() => p.onAddressOpen(false)}
        placeholder={`Search ${p.searchAll ? "everywhere" : p.cwdLabel} or enter a path`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {error && <span className="address-error ellipsis" title={error}>{error}</span>}
      {!typingPath && (p.addressOpen || p.searchAll) && (
        <button
          className={"address-scope" + (p.searchAll ? " all" : "")}
          title={p.searchAll ? `Search only ${p.cwdLabel} (Tab)` : "Search everywhere (Tab)"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (isPathLike(text)) setText("");
            p.onSearchAll(!p.searchAll);
            input.current?.focus();
          }}
        >
          {p.addressOpen && <kbd>Tab</kbd>}
          {p.searchAll ? "Everywhere" : "Search everywhere"}
        </button>
      )}
      {p.query && (
        <button
          className="address-clear"
          title="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={close}
        >
          <CloseIcon />
        </button>
      )}
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

  const batch = urls.length > 1;
  return (
    <div className="paste-prompt">
      <div className="add-bar">
        <span className="add-label">
          Add {batch ? `${urls.length} links` : "link"} to <span className="mono ink">{dirLabel}/</span>
        </span>
        <span className="paste-urls mono ellipsis" title={batch ? undefined : urls[0]}>
          {batch ? "" : urls[0]}
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
      {batch && (
        <ol className="paste-list mono">
          {urls.map((url) => (
            <li key={url} className="ellipsis" title={url}>
              {url}
            </li>
          ))}
        </ol>
      )}
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
