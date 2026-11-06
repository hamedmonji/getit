import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, CircleArrowUp, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LinkInfo, RenameRule } from "../lib/engine";
import { crumbSeparator, isPathLike } from "../lib/paths";
import { IS_MAC, IS_WINDOWS, MOD } from "../lib/platform";
import { WindowControls } from "./WindowControls";
import { useAutoNames } from "../hooks/useAutoNames";
import { useLinkInfo } from "../hooks/useLinkInfo";
import { useFilesHere } from "../hooks/useFilesHere";
import {
  batchDuplicates,
  choose,
  duplicateView,
  groupDuplicates,
  planBatch,
  syncPicks,
  tick,
  type BatchPicks,
  type BatchPlan,
  type Downloads,
} from "../lib/batchDuplicates";
import { chosen, moveTo, syncOrder, syncSelected, totalLabel } from "../lib/batch";
import { LinkBatch } from "./LinkBatch";
import { linkHeading, type ViewMode } from "../lib/viewModels";
import type { UpdateAction, UpdateCard as UpdateCardVm } from "../lib/update";
import { ProgressBar } from "./Glyphs";
import {
  BackIcon,
  CloseIcon,
  FilterIcon,
  FolderIcon,
  ForwardIcon,
  GearIcon,
  GridIcon,
  ListIcon,
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


export interface ToolbarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  /** The current folder as shown to the user, such as `~/Movies`. */
  cwdLabel: string;
  /** The folders from home (or the root) down to the current one; `drop: false` for one items can't be dropped on. */
  crumbs: { label: string; path: string; drop?: boolean }[];
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
  /** Whether folders without a queue inside them, and files that aren't downloads, are shown. */
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
  onToggleSettings: () => void;
}

// The design's icon colours where shadcn's differ: a disabled icon drops to the
// track colour rather than fading the button, and a pressed one is tinted.
const DISABLED = "disabled:opacity-100 disabled:text-track";
const PRESSED =
  "aria-pressed:bg-tint-soft aria-pressed:text-tint data-[state=on]:bg-tint-soft data-[state=on]:text-tint";

export function Toolbar(p: ToolbarProps) {
  return (
    <div className={"toolbar" + (IS_WINDOWS ? " toolbar-windows" : "")} data-tauri-drag-region>
      {/* Room for the native macOS window buttons, which sit over the toolbar. */}
      {IS_MAC && <div className="traffic-light-space" data-tauri-drag-region />}
      <div className="nav-buttons">
        <Button variant="ghost" size="icon" className={DISABLED} title={`Back (${MOD}[)`} disabled={!p.canBack} onClick={p.onBack}>
          <BackIcon />
        </Button>
        <Button variant="ghost" size="icon" className={DISABLED} title={`Forward (${MOD}])`} disabled={!p.canForward} onClick={p.onForward}>
          <ForwardIcon />
        </Button>
        <Button variant="ghost" size="icon" className={DISABLED} title="Enclosing folder" disabled={!p.canUp} onClick={p.onUp}>
          <UpIcon />
        </Button>
      </div>
      <AddressBar {...p} />
      <Toggle
        variant="outline"
        className={PRESSED}
        title={`${p.showAllFolders ? "Show only downloads and folders with downloads" : "Show all folders and files"} (${MOD}.)`}
        pressed={p.showAllFolders}
        onPressedChange={p.onToggleFolders}
      >
        <FolderIcon />
      </Toggle>
      {/* A segmented control: the selected view is raised out of a recessed track. */}
      <ToggleGroup
        type="single"
        spacing={0.5}
        className="h-8 border border-line bg-panel2 p-0.5"
        value={p.mode}
        // Clicking the selected view would clear it; there's always one.
        onValueChange={(m) => m && p.onMode(m as ViewMode)}
      >
        {(["Icons", "List"] as const).map((m, i) => (
          <ToggleGroupItem
            key={m}
            value={m}
            className="h-full w-[30px] min-w-0 rounded-md px-0 text-ink-muted hover:bg-transparent hover:text-ink data-[state=on]:bg-panel data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
            title={`${m} (${MOD}${i + 1})`}
            aria-label={m}
          >
            {m === "Icons" ? <GridIcon /> : <ListIcon />}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        variant="outline"
        size="icon"
        className={DISABLED}
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
        {p.queueState === "running" ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button variant="outline" size="icon" title={p.theme === "Dark" ? "Light mode" : "Dark mode"} onClick={p.onToggleTheme}>
        <ThemeIcon />
      </Button>
      <Button variant="outline" size="icon" title="Add a download" onClick={p.onToggleAdd}>
        <PlusIcon />
      </Button>
      <Button variant="outline" size="icon" title={`Settings (${MOD},)`} onClick={p.onToggleSettings}>
        <GearIcon />
      </Button>
      {IS_WINDOWS && <WindowControls />}
    </div>
  );
}

/**
 * The current folder's path, which turns into a field when clicked: text starting with `/`
 * or `~` is a path to go to on Enter, anything else searches as it's typed.
 * The field stays while a search is shown. Its margins leave toolbar on both
 * sides to drag the window by.
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
    // first when space runs out, losing their start rather than their end.
    const parents = p.crumbs.slice(0, -1);
    const current = p.crumbs[p.crumbs.length - 1];
    return (
      <InputGroup
        className="mx-6 flex-1 cursor-text"
        title="Click to enter a path or search"
        onClick={() => p.onAddressOpen(true)}
      >
        <div className="address-path">
          {parents.length > 0 && (
            <span className="address-parent">
              <span className="address-run">
                {parents.map((c) => (
                  <span key={c.path}>
                    <span
                      className={"address-segment" + (p.dropTarget === c.path ? " drop-target" : "")}
                      data-drop={c.drop === false ? undefined : c.path}
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onCrumb(c.path);
                      }}
                    >
                      {c.label}
                    </span>
                    {crumbSeparator(c.path)}
                  </span>
                ))}
              </span>
            </span>
          )}
          <span className="address-name">
            <span className="address-run">{current.label}</span>
          </span>
        </div>
      </InputGroup>
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
    <InputGroup className="mx-6 flex-1">
      <InputGroupAddon className="text-ink-muted">{isPathLike(text) ? <FolderIcon /> : <SearchIcon />}</InputGroupAddon>
      <InputGroupInput
        ref={input}
        className="font-mono"
        aria-invalid={!!error}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
          p.onQuery(isPathLike(e.target.value) ? "" : e.target.value.trim());
        }}
        onKeyDown={onKey}
        onFocus={() => p.onAddressOpen(true)}
        onBlur={(e) => {
          // The filter menu takes focus while it's open; the field stays meanwhile.
          if (e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-slot="dropdown-menu-content"]')) return;
          p.onAddressOpen(false);
        }}
        placeholder={`Search ${p.searchAll ? "everywhere" : p.cwdLabel} or enter a path`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {error && (
        <InputGroupAddon align="inline-end" className="max-w-1/2 min-w-0">
          <InputGroupText className="min-w-0 text-destructive" title={error}>
            <span className="truncate">{error}</span>
          </InputGroupText>
        </InputGroupAddon>
      )}
      {!typingPath && (
        <InputGroupAddon align="inline-end">
          {(p.addressOpen || p.searchAll) && (
            <InputGroupButton
              variant={p.searchAll ? "secondary" : "ghost"}
              title={p.searchAll ? `Search only ${p.cwdLabel} (Tab)` : "Search everywhere (Tab)"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (isPathLike(text)) setText("");
                p.onSearchAll(!p.searchAll);
                input.current?.focus();
              }}
            >
              {p.addressOpen && <Kbd>Tab</Kbd>}
              {p.searchAll ? "Everywhere" : "Search everywhere"}
            </InputGroupButton>
          )}
          <SearchFilter kinds={p.searchKinds} onKinds={p.onSearchKinds} onClosed={() => input.current?.focus()} />
          {p.query && (
            <InputGroupButton size="icon-xs" className="text-ink-muted" title="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={close}>
              <CloseIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/**
 * The search's filter button and its menu: check folders, files or both (or
 * neither, which also shows both). Stays open while checking, so both can be
 * set at once; closing it puts focus back in the search field.
 */
function SearchFilter({
  kinds,
  onKinds,
  onClosed,
}: {
  kinds: SearchKind[];
  onKinds: (kinds: SearchKind[]) => void;
  onClosed: () => void;
}) {
  const only = kinds.length === 1 ? SEARCH_KINDS.find((k) => k.kind === kinds[0])!.label : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          // Tinted while it filters, even when hovered or open.
          className={
            kinds.length
              ? "bg-tint-soft text-tint hover:bg-tint-soft hover:text-tint aria-expanded:bg-tint-soft aria-expanded:text-tint"
              : "text-ink-muted"
          }
          size={only ? "xs" : "icon-xs"}
          title="Search only folders or files"
        >
          <FilterIcon />
          {only}
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        {SEARCH_KINDS.map(({ kind, label }) => (
          <DropdownMenuCheckboxItem
            key={kind}
            checked={kinds.includes(kind)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => onKinds(checked ? [...kinds, kind] : kinds.filter((k) => k !== kind))}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
        <Input
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
          aria-invalid={!!error}
          className={mono ? "font-mono" : undefined}
        />
        {error && <span className="add-error">{error}</span>}
      </div>
      <Button variant="outline" onClick={submit}>
        {submitLabel}
      </Button>
    </div>
  );
}

/** A link under its file name and size, or a placeholder while the server is asked. */
function LinkWithInfo({ url, info }: { url: string; info: LinkInfo | null | undefined }) {
  const heading = linkHeading(url, info);
  return (
    <span className="paste-link" title={url}>
      <span className={`paste-name ellipsis${heading.fetching ? " fetching" : ""}`}>{heading.text}</span>
      <span className="paste-url mono ellipsis">{url}</span>
    </span>
  );
}

/** How a batch of links handles the ones that already exist, in the batch itself. */
export interface BatchDuplicateCheck {
  /** The downloads to check against. */
  state: Downloads;
  /** A folder as shown, such as `~/Movies`. */
  whereLabel: (dir: string) => string;
  /** Adds the batch as the user chose, duplicates and all. */
  onAddBatch: (plan: BatchPlan) => void;
}

/**
 * Links waiting at the bottom of the window to be added, each with its file
 * name and size once the server has given them. Several show as a table to
 * tick and order them; the ticked ones are added in that order. With
 * `duplicates`, links that already exist are shown first in the table, each
 * with a choice of what to do. `extra` goes before the buttons.
 */
function LinksPrompt({
  urls,
  dir,
  rename,
  dirLabel,
  closeLabel,
  autoFocus = false,
  extra,
  duplicates,
  onAdd,
  onClose,
}: {
  urls: string[];
  /** Folder the links would be added to. */
  dir: string | null;
  /** Its queue's auto rename, to show the names the links would get. */
  rename: RenameRule[] | undefined;
  dirLabel: string;
  closeLabel: string;
  /** Focuses the add button, so Enter adds. */
  autoFocus?: boolean;
  extra?: ReactNode;
  duplicates?: BatchDuplicateCheck;
  /**
   * Starts adding these links, in this order. The prompt closes at once; the
   * links show in the folder while they're checked.
   */
  onAdd: (urls: string[]) => void;
  onClose: () => void;
}) {
  const infos = useAutoNames(dir, rename, useLinkInfo(urls));
  const [order, setOrder] = useState(urls);
  const [stored, setPicks] = useState<BatchPicks>(() => ({ ticked: new Set(urls), choices: {} }));
  // Captured links can arrive or leave while this is open.
  const [seen, setSeen] = useState(urls);
  if (seen !== urls) {
    setSeen(urls);
    setOrder((o) => syncOrder(o, urls));
    setPicks((p) => ({ ...p, ticked: syncSelected(p.ticked, seen, urls) }));
  }

  const batch = urls.length > 1;
  const checking = batch && dir !== null && duplicates ? duplicates : null;
  const names = checking ? urls.flatMap((u) => (infos[u] ? [infos[u]!.file_name] : [])) : [];
  const filesHere = useFilesHere(checking ? dir : null, names);
  const dups = checking && dir ? batchDuplicates(order, infos, dir, checking.state, filesHere) : {};
  const dupUrls = groupDuplicates(order, dups).dups;
  // Links found to be duplicates start skipped, as the server's names arrive.
  const picks = syncPicks(stored, dupUrls);
  if (picks !== stored) setPicks(picks);
  const view =
    checking &&
    duplicateView(dupUrls, dups, picks.choices, dirLabel, (d) =>
      checking.whereLabel(d.kind === "file" ? dir! : (checking.state.queues[d.existing.queue_id]?.dir ?? dir!)),
    );

  const adding = batch ? chosen(order, picks.ticked) : urls;
  const add = () => {
    if (checking && dir) checking.onAddBatch(planBatch(order, picks, dups, dir));
    else onAdd(adding);
    onClose();
  };

  return (
    <div className="paste-prompt">
      <div className="add-bar">
        <span className="paste-urls">
          {batch ? (
            <span className="link-batch-total">{totalLabel(adding, infos)}</span>
          ) : (
            <LinkWithInfo url={urls[0]} info={infos[urls[0]]} />
          )}
        </span>
        {extra}
        <Button variant="outline" onClick={onClose}>
          {closeLabel}
        </Button>
        <Button variant="outline" title={`Add to ${dirLabel}/`} autoFocus={autoFocus} disabled={!adding.length} onClick={add}>
          {batch ? `Add ${adding.length} here` : "Add here"}
        </Button>
      </div>
      {batch && (
        <LinkBatch
          order={order}
          ticked={picks.ticked}
          infos={infos}
          duplicates={view}
          onTick={(urls, on) => setPicks((p) => tick(syncPicks(p, dupUrls), urls, on))}
          onTickAll={(on) => setPicks((p) => tick(syncPicks(p, dupUrls), order, on))}
          onMove={(urls, index) => setOrder((o) => moveTo(o, urls, index))}
          onChoose={(urls, choice) => setPicks((p) => choose(syncPicks(p, dupUrls), urls, choice))}
        />
      )}
    </div>
  );
}

/** Asks whether to add the links found on the clipboard. Enter adds, Escape cancels. */
export function PasteBar({
  urls,
  dir,
  rename,
  dirLabel,
  duplicates,
  onAdd,
  onAddBatch,
  onClose,
}: {
  urls: string[];
  dir: string | null;
  rename: RenameRule[] | undefined;
  dirLabel: string;
  /** For several links: the downloads they're checked against, and folders as shown. */
  duplicates: Omit<BatchDuplicateCheck, "onAddBatch">;
  /** Starts adding the chosen links, in order; `always` skips this prompt from now on. */
  onAdd: (urls: string[], always: boolean) => void;
  /** Adds several links as the user chose, duplicates and all. */
  onAddBatch: (plan: BatchPlan, always: boolean) => void;
  onClose: () => void;
}) {
  const [always, setAlways] = useState(false);
  const alwaysId = useId();
  return (
    <LinksPrompt
      urls={urls}
      dir={dir}
      rename={rename}
      dirLabel={dirLabel}
      closeLabel="Cancel"
      autoFocus
      extra={
        <div className="paste-always">
          <Checkbox id={alwaysId} checked={always} onCheckedChange={(checked) => setAlways(checked === true)} />
          <Label htmlFor={alwaysId}>Don't ask again</Label>
        </div>
      }
      duplicates={{ ...duplicates, onAddBatch: (plan) => onAddBatch(plan, always) }}
      onAdd={(chosen) => onAdd(chosen, always)}
      onClose={onClose}
    />
  );
}

/**
 * Links the browser extension captured, waiting at the bottom of the window
 * until the user adds them to the folder they're in or dismisses them. They
 * stay while the user goes to another folder, so they can be added there.
 */
export function CapturedBar({
  urls,
  dir,
  rename,
  dirLabel,
  onAdd,
  onClose,
}: {
  urls: string[];
  dir: string | null;
  rename: RenameRule[] | undefined;
  dirLabel: string;
  /** Starts adding the chosen links to the current folder, in order. */
  onAdd: (urls: string[]) => void;
  onClose: () => void;
}) {
  return (
    <LinksPrompt
      urls={urls}
      dir={dir}
      rename={rename}
      dirLabel={dirLabel}
      closeLabel="Dismiss"
      onAdd={onAdd}
      onClose={onClose}
    />
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
        <Button variant="outline" autoFocus onClick={onClose}>
          Keep downloading
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onPause();
            onClose();
          }}
        >
          Pause anyway
        </Button>
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
            <Button variant="outline" onClick={onSkip}>
              Skip all
            </Button>
            <Button variant="outline" onClick={onAdd}>
              Add all as duplicates
            </Button>
            <Button autoFocus onClick={onMain}>
              {mainLabel}
            </Button>
          </div>
        )}
      </div>
      <ul className="dup-rows">
        {rows.map((row, i) => (
          <Item key={row.key} asChild variant="outline" size="sm">
            <li>
              <ItemContent className="min-w-0">
                <ItemTitle title={row.name}>{row.name}</ItemTitle>
                <div className="dup-meta">
                  <Badge variant="secondary">{row.status}</Badge>
                  <span>in</span>
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto min-w-0 p-0"
                    title={row.here ? "Select it" : `Go to ${row.where}`}
                    onClick={() => onWhere(i)}
                  >
                    <span className={"ellipsis" + (row.here ? "" : " mono")}>{row.where}</span>
                  </Button>
                  {row.note && <span className="ellipsis">· {row.note}</span>}
                </div>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" onClick={() => onRowSkip(i)}>
                  Skip
                </Button>
                <Button variant="outline" onClick={() => onRowAdd(i)}>
                  Add as duplicate
                </Button>
                {/* Start or show, whichever label, lines up from row to row. */}
                <Button
                  variant={batch ? "outline" : "default"}
                  className="min-w-28"
                  autoFocus={!batch}
                  onClick={() => onRowMain(i)}
                >
                  {row.action}
                </Button>
              </ItemActions>
            </li>
          </Item>
        ))}
      </ul>
    </div>
  );
}

/**
 * The update card along the bottom of the folder view: a new version to
 * download, its download, restarting into it (now, or once the running
 * downloads finish), and that it was updated.
 */
export function UpdateCard({
  card,
  onAction,
}: {
  card: UpdateCardVm;
  onAction: (action: UpdateAction) => void;
}) {
  const Icon = { update: CircleArrowUp, waiting: Clock, done: Check }[card.icon];
  return (
    <div className="update-card" role="status" aria-label="Update getit">
      <Icon className={card.icon === "waiting" ? "update-icon muted" : "update-icon"} />
      {/* While downloading, the bar takes the room instead. */}
      <span className={card.progress ? "update-text update-text-snug" : "update-text"}>
        <span className="font-semibold">{card.title}</span>
        {card.detail && <span className="muted"> · {card.detail}</span>}
      </span>
      {card.progress && (
        <>
          <ProgressBar className="update-bar" pct={card.pct ?? 0} color="var(--tint)" />
          {card.pct !== null && <span className="update-pct">{card.pct}%</span>}
        </>
      )}
      {card.actions.length > 0 && (
        <div className="flex gap-1.5">
          {card.actions.map((a) => (
            <Button
              key={a.action}
              variant="outline"
              className={a.primary ? "update-primary" : undefined}
              autoFocus={a.primary}
              onClick={() => onAction(a.action)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
