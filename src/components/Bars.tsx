import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isPathLike } from "../lib/paths";
import type { ViewMode } from "../lib/viewModels";
import type { UpdatePhase } from "../hooks/useUpdate";
import {
  BackIcon,
  CloseIcon,
  ExpandIcon,
  FilterIcon,
  FolderIcon,
  ForwardIcon,
  GearIcon,
  GridIcon,
  ListIcon,
  OverviewIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  ThemeIcon,
  UpIcon,
} from "./icons";

export type Theme = "Light" | "Dark";

/** What a search can be narrowed to. None selected shows both. */
export type SearchKind = "folders" | "files";
const SEARCH_KINDS: { kind: SearchKind; label: string }[] = [
  { kind: "folders", label: "Folders" },
  { kind: "files", label: "Files" },
];

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
  /** The kinds of item the search is narrowed to; empty means both. */
  searchKinds: SearchKind[];
  onSearchKinds: (kinds: SearchKind[]) => void;
  /** Goes to a typed path; rejects with a message to show. */
  onGoTo: (raw: string) => Promise<void>;
  /** Moves from the search field to its results. */
  onSearchResults: () => void;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  /** Whether folders without a queue inside them are shown. */
  showAllFolders: boolean;
  onToggleFolders: () => void;
  /**
   * The current folder's queue: whether it's stopped or running, or "empty" with
   * nothing left to download; null when it has none.
   */
  queueState: "stopped" | "running" | "empty" | null;
  onToggleQueue: () => void;
  onToggleAdd: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  overviewOpen: boolean;
  /** Downloads running anywhere, shown on the overview button. */
  activeCount: number;
  onToggleOverview: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
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
        className={"square-btn" + (p.showAllFolders ? " toggled" : "")}
        title={`${p.showAllFolders ? "Show only folders with downloads" : "Show all folders"} (${MOD}.)`}
        aria-pressed={p.showAllFolders}
        onClick={p.onToggleFolders}
      >
        <FolderIcon />
      </button>
      <div className="segmented">
        {(["Icons", "List"] as const).map((m, i) => (
          <button
            key={m}
            title={`${m} (${MOD}${i + 1})`}
            className={p.mode === m ? "active" : ""}
            onClick={() => p.onMode(m)}
          >
            {m === "Icons" ? <GridIcon /> : <ListIcon />}
          </button>
        ))}
      </div>
      {<button
        className="square-btn"
        title={
          p.queueState === "empty"
            ? "Nothing to download in this queue"
            : p.queueState === "stopped"
              ? "Resume queue"
              : "Pause queue"
        }
        disabled={!p.queueState || p.queueState === "empty"}
        onClick={p.onToggleQueue}
      >
        {p.queueState === "running" ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
      </button>}
      <button
        className="square-btn"
        title={p.theme === "Dark" ? "Light mode" : "Dark mode"}
        onClick={p.onToggleTheme}
      >
        <ThemeIcon />
      </button>
      <button className="square-btn" onClick={p.onToggleAdd}>
        <PlusIcon />
      </button>
      <button
        className={"square-btn overview-btn" + (p.overviewOpen ? " toggled" : "")}
        title={`${p.overviewOpen ? "Hide overview" : "Show overview"} (${MOD}O)`}
        aria-pressed={p.overviewOpen}
        onClick={p.onToggleOverview}
      >
        <OverviewIcon />
        {p.activeCount > 0 && <span className="overview-badge">{p.activeCount}</span>}
      </button>
      <button
        className={"square-btn" + (p.settingsOpen ? " toggled" : "")}
        title={`${p.settingsOpen ? "Hide settings" : "Settings"} (${MOD},)`}
        aria-pressed={p.settingsOpen}
        onClick={p.onToggleSettings}
      >
        <GearIcon />
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
  /** Where the filter dropdown opens, under its button; null while closed. */
  const [filterAt, setFilterAt] = useState<{ left: number; top: number } | null>(null);
  const searching = p.addressOpen || !!p.query;
  useEffect(() => {
    if (!searching) setFilterAt(null);
  }, [searching]);

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
    // first when space runs out, losing their start rather than their end.
    const parents = p.crumbs.slice(0, -1);
    const current = p.crumbs[p.crumbs.length - 1];
    return (
      <div className="address-bar" title="Click to enter a path or search" onClick={() => p.onAddressOpen(true)}>
        {parents.length > 0 && (
          <span className="address-parent">
            <span className="address-run">
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
          </span>
        )}
        <span className="address-name">
          <span className="address-run">{current.label}</span>
        </span>
      </div>
    );
  }

  const close = () => {
    p.onQuery("");
    p.onAddressOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && filterAt) {
      setFilterAt(null);
    } else if (e.key === "Escape") {
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
      {!typingPath && (p.addressOpen || p.query) && (
        <button
          className={"address-filter" + (p.searchKinds.length ? " on" : "") + (filterAt ? " open" : "")}
          title="Search only folders or files"
          aria-haspopup="menu"
          aria-expanded={!!filterAt}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setFilterAt(filterAt ? null : { left: r.right, top: r.bottom + 6 });
            input.current?.focus();
          }}
        >
          <FilterIcon />
          {p.searchKinds.length === 1 && SEARCH_KINDS.find((k) => k.kind === p.searchKinds[0])!.label}
        </button>
      )}
      {filterAt && (
        <SearchFilter at={filterAt} kinds={p.searchKinds} onKinds={p.onSearchKinds} onClose={() => setFilterAt(null)} />
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

/**
 * The dropdown under the search's filter button: check folders, files or both
 * (or neither, which also shows both). Stays open while checking, so both can
 * be set at once; clicks don't take focus from the search field.
 */
function SearchFilter({
  at,
  kinds,
  onKinds,
  onClose,
}: {
  /** Its top right corner, under the button. */
  at: { left: number; top: number };
  kinds: SearchKind[];
  onKinds: (kinds: SearchKind[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!ref.current?.contains(target) && !target.closest?.(".address-filter")) onClose();
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu search-filter"
      role="menu"
      style={{ left: at.left, top: at.top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="menu-header">Show</div>
      {SEARCH_KINDS.map(({ kind, label }) => {
        const checked = kinds.includes(kind);
        return (
          <button
            key={kind}
            className="menu-item"
            role="menuitemcheckbox"
            aria-checked={checked}
            onClick={() => onKinds(checked ? kinds.filter((k) => k !== kind) : [...kinds, kind])}
          >
            <span className="menu-check">{checked ? "✓" : ""}</span>
            {label}
          </button>
        );
      })}
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

/**
 * Links the browser extension captured, waiting at the bottom of the window
 * until the user adds them to the folder they're in or dismisses them. They
 * stay while the user goes to another folder, so they can be added there.
 */
export function CapturedBar({
  urls,
  dirLabel,
  onAdd,
  onClose,
}: {
  urls: string[];
  dirLabel: string;
  /** Adds the links to the current folder. Rejects with a message to show. */
  onAdd: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    try {
      await onAdd();
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  const batch = urls.length > 1;
  return (
    <div className="paste-prompt captured">
      <div className="add-bar">
        <span className="add-label">Captured from browser{batch ? `: ${urls.length} links` : ""}</span>
        <span className="paste-urls mono ellipsis" title={batch ? undefined : urls[0]}>
          {batch ? "" : urls[0]}
        </span>
        {error && (
          <span className="status-warning ellipsis" title={error}>
            {error}
          </span>
        )}
        <button className="plain-btn" onClick={onClose}>
          Dismiss
        </button>
        <button className="plain-btn" title={`Add to ${dirLabel}/`} onClick={add}>
          Add here
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

/**
 * Asks before pausing downloads whose server can't resume them, since pausing
 * throws away what they've downloaded. Enter keeps them going, Escape too.
 */
export function PauseBar({
  names,
  lost,
  onPause,
  onClose,
}: {
  /** The downloads being paused. */
  names: string[];
  /** How much they've downloaded between them, such as "340 MB". */
  lost: string;
  onPause: () => void;
  onClose: () => void;
}) {
  const batch = names.length > 1;
  return (
    <div className="paste-prompt" role="alertdialog" aria-label="Pause download">
      <div className="add-bar">
        <span className="add-label">
          Pause {batch ? `${names.length} downloads` : <span className="ink">{names[0]}</span>}?
        </span>
        <span className="paste-urls muted ellipsis">
          The server can't resume {batch ? "them" : "it"}, so the {lost} downloaded so far will be lost and{" "}
          {batch ? "they start" : "it starts"} over.
        </span>
        <button className="plain-btn" autoFocus onClick={onClose}>
          Keep downloading
        </button>
        <button
          className="plain-btn"
          onClick={() => {
            onPause();
            onClose();
          }}
        >
          Pause anyway
        </button>
      </div>
      {batch && (
        <ol className="paste-list">
          {names.map((name, i) => (
            <li key={i} className="ellipsis" title={name}>
              {name}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A link being added that's already a download, or a file, somewhere. */
export interface DuplicateRow {
  key: string;
  /** The existing download's or file's name. */
  name: string;
  /** Its folder, such as `~/TV Shows/The diplomat`, or "This Queue" for the folder on screen. */
  where: string;
  /** The folder on screen, so `where` is a label rather than a path. */
  here?: boolean;
  /** Its state, such as "Paused" or "Finished". */
  status: string;
  /** Why it counts as the same, when not the same link. */
  note?: string;
  /** Its start button: "Start existing", or a show label when it can't start. */
  action: string;
}

/**
 * Shown at the bottom when links being added already exist: lists each existing
 * download or file and where it is. Each can be skipped, added again, or its
 * existing download started (or shown); with several, the same three apply to
 * all at once from the top. The list scrolls past a height that keeps the queue
 * in view. Enter picks the start (or show) button that has focus, Escape skips all.
 */
export function DuplicatePanel({
  rows,
  mainLabel,
  onMain,
  onAdd,
  onSkip,
  onRowMain,
  onRowAdd,
  onRowSkip,
  onWhere,
}: {
  rows: DuplicateRow[];
  /** For all: "Start all existing" when any can start, otherwise a show label. */
  mainLabel: string;
  onMain: () => void;
  onAdd: () => void;
  onSkip: () => void;
  onRowMain: (index: number) => void;
  onRowAdd: (index: number) => void;
  onRowSkip: (index: number) => void;
  /** Goes to one row's folder. */
  onWhere: (index: number) => void;
}) {
  const batch = rows.length > 1;
  return (
    <div className="dup-panel" role="alertdialog" aria-label="Already downloaded">
      <div className="dup-head">
        <div className="dup-title">{batch ? `${rows.length} links are already downloaded` : "Already downloaded"}</div>
        {batch && (
          <div className="dup-buttons">
            <button className="plain-btn" onClick={onSkip}>
              Skip all
            </button>
            <button className="plain-btn" onClick={onAdd}>
              Add all as duplicates
            </button>
            <button className="primary-btn" autoFocus onClick={onMain}>
              {mainLabel}
            </button>
          </div>
        )}
      </div>
      <ul className="dup-rows">
        {rows.map((row, i) => (
          <li key={row.key} className="dup-row">
            <div className="dup-main">
              <div className="dup-name ellipsis" title={row.name}>
                {row.name}
              </div>
              <div className="dup-meta">
                <span className="dup-status">{row.status}</span>
                <span>in</span>
                <button
                  className={"dup-where ellipsis" + (row.here ? "" : " mono")}
                  title={row.here ? "Select it" : `Go to ${row.where}`}
                  onClick={() => onWhere(i)}
                >
                  {row.where}
                </button>
                {row.note && <span className="ellipsis">· {row.note}</span>}
              </div>
            </div>
            <div className="dup-buttons">
              <button className="plain-btn" onClick={() => onRowSkip(i)}>
                Skip
              </button>
              <button className="plain-btn" onClick={() => onRowAdd(i)}>
                Add as duplicate
              </button>
              <button
                className={batch ? "plain-btn" : "primary-btn"}
                autoFocus={!batch}
                onClick={() => onRowMain(i)}
              >
                {row.action}
              </button>
            </div>
          </li>
        ))}
      </ul>
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
  detailsOpen,
  onToggleDetails,
}: {
  itemCount: string;
  selInfo: string;
  left: string;
  speed: string;
  warning: string | null;
  /** A passing message, such as why a move failed. */
  notice: string | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
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
      <button
        className={detailsOpen ? "status-expand on" : "status-expand"}
        title={`${detailsOpen ? "Hide" : "Show"} details (${MOD}I)`}
        aria-pressed={detailsOpen}
        onClick={onToggleDetails}
      >
        <ExpandIcon open={detailsOpen} />
      </button>
    </div>
  );
}

/** Offers a newer version of getit, then shows its download and asks to restart into it. */
export function UpdateBar({
  version,
  phase,
  onInstall,
  onRestart,
  onClose,
}: {
  version: string;
  phase: UpdatePhase;
  onInstall: () => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <div className="paste-prompt" role="alertdialog" aria-label="Update getit">
      <div className="add-bar">
        <span className="add-label">
          {phase.kind === "ready" ? (
            <>getit {version} is installed.</>
          ) : (
            <>
              getit <span className="ink">{version}</span> is available.
            </>
          )}
        </span>
        <span className="paste-urls muted ellipsis">
          {phase.kind === "downloading"
            ? phase.pct === null
              ? "Downloading…"
              : `Downloading… ${phase.pct}%`
            : phase.kind === "ready"
              ? "Restart getit to start using it."
              : phase.kind === "failed"
                ? `Couldn't update: ${phase.error}`
                : ""}
        </span>
        {phase.kind !== "downloading" && (
          <button className="plain-btn" onClick={onClose}>
            Later
          </button>
        )}
        {(phase.kind === "available" || phase.kind === "failed") && (
          <button className="plain-btn" autoFocus onClick={onInstall}>
            {phase.kind === "failed" ? "Try again" : "Update"}
          </button>
        )}
        {phase.kind === "ready" && (
          <button className="plain-btn" autoFocus onClick={onRestart}>
            Restart now
          </button>
        )}
      </div>
    </div>
  );
}
