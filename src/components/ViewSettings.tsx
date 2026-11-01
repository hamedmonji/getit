import { useState, type KeyboardEvent } from "react";
import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import type { DownloadItem } from "../lib/engine";
import {
  VIEW_KINDS,
  VIEW_LAYOUTS,
  VIEW_STATUSES,
  addExts,
  addSource,
  downloadHosts,
  extSuggestions,
  layoutHint,
  parseExts,
  removeExt,
  removeSource,
  siteBadge,
  siteOptions,
  toggleKind,
  toggleSubdomains,
  typesHint,
  type View,
  type ViewLayout,
  type ViewStatus,
} from "../lib/views";
import { CloseIcon } from "./icons";
import { Segmented } from "./QueueSettingsForm";

/**
 * The side panel for the view on screen, in place of the queue settings: its
 * name, how it shows its downloads, and which ones it shows, by type, by the
 * site they came from and by how far along they are. Changes save as they're made.
 */
export function ViewSettings({
  view,
  items,
  onChange,
  onDelete,
  onClose,
}: {
  view: View;
  /** Every download, to offer extensions and sites from. */
  items: DownloadItem[];
  onChange: (patch: Partial<View>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="overview queue-settings-panel" aria-label="View settings">
      <div className="overview-head">
        <div className="queue-settings-folder">
          <Layers size={16} />
          <span className="ellipsis">View settings</span>
        </div>
        <span className="overview-total" />
        <Button variant="ghost" size="icon-sm" className="text-ink-muted" title="Close" onClick={onClose}>
          <CloseIcon />
        </Button>
      </div>
      {/* Keyed so drafts being typed don't carry over to another view. */}
      <div key={view.id} className="queue-settings-body">
        <section className="qs-section">
          <span className="qs-label">Name</span>
          <Input className="vs-input" aria-label="View name" value={view.name} onChange={(e) => onChange({ name: e.target.value })} />
        </section>

        <section className="qs-section">
          <div className="qs-row">
            <span className="qs-label">Show</span>
            <Segmented value={view.layout} options={VIEW_LAYOUTS} onChange={(l) => onChange({ layout: l as ViewLayout })} />
          </div>
          <p className="qs-hint">{layoutHint(view.layout)}</p>
        </section>

        <TypeSection view={view} items={items} onChange={onChange} />
        <SourceSection view={view} items={items} onChange={onChange} />

        <section className="qs-section">
          <span className="qs-label">Status</span>
          <Segmented value={view.status} options={VIEW_STATUSES} onChange={(s) => onChange({ status: s as ViewStatus })} />
        </section>

        <section className="qs-section">
          <Button variant="outline" size="sm" className="w-full text-destructive" onClick={onDelete}>
            Delete view
          </Button>
        </section>
      </div>
    </aside>
  );
}

/** Kinds to pick, extensions typed as tokens, and the extensions downloads have to add with a click. */
function TypeSection({ view, items, onChange }: { view: View; items: DownloadItem[]; onChange: (patch: Partial<View>) => void }) {
  const [draft, setDraft] = useState("");
  const suggest = extSuggestions(view, items);
  const add = (text: string) => {
    setDraft("");
    const exts = parseExts(text);
    if (exts.length) onChange(addExts(view, exts));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && view.exts.length) {
      onChange(removeExt(view, view.exts[view.exts.length - 1]));
    }
  };
  return (
    <section className="qs-section">
      <span className="qs-label">File type</span>
      <div className="vs-chips">
        {VIEW_KINDS.map(([kind, label]) => (
          <Toggle
            key={kind}
            variant="outline"
            size="sm"
            className="vs-chip"
            pressed={view.kinds.includes(kind)}
            onPressedChange={() => onChange(toggleKind(view, kind))}
          >
            {label}
          </Toggle>
        ))}
      </div>
      <div className="vs-tokens">
        {view.exts.map((ext) => (
          <Badge key={ext} className="vs-token">
            .{ext}
            <button type="button" className="vs-token-remove" title="Remove" onClick={() => onChange(removeExt(view, ext))}>
              <CloseIcon size={8} />
            </button>
          </Badge>
        ))}
        <input
          className="vs-token-input"
          aria-label="Extensions"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={draft}
          placeholder={view.exts.length ? "Add more" : "Extensions, e.g. mkv, srt"}
          onChange={(e) => {
            const text = e.target.value;
            // A comma or space ends an extension.
            if (/[,\s]$/.test(text)) add(text);
            else setDraft(text);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
        />
      </div>
      {suggest.length > 0 && (
        <div className="vs-suggest">
          <span className="qs-hint">In your downloads:</span>
          {suggest.map((ext) => (
            <Button key={ext} variant="outline" size="xs" className="vs-suggestion" onClick={() => onChange(addExts(view, [ext]))}>
              + .{ext}
            </Button>
          ))}
        </div>
      )}
      <p className="qs-hint">{typesHint(view)}</p>
    </section>
  );
}

/**
 * The sites the view's downloads come from, each for that host alone or with
 * its subdomains (`*.`), and a field to add one: it offers the hosts
 * downloads came from as it's typed, or the site typed.
 */
function SourceSection({ view, items, onChange }: { view: View; items: DownloadItem[]; onChange: (patch: Partial<View>) => void }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const hosts = downloadHosts(items);
  const options = siteOptions(view, hosts, draft);
  const add = (domain: string) => {
    setDraft("");
    setHighlight(0);
    onChange(addSource(view, domain, hosts));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[highlight];
      if (option) add(option.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      e.currentTarget.blur();
    }
  };
  return (
    <section className="qs-section">
      <span className="qs-label">Source</span>
      {view.sources.map(({ domain, sub }) => (
        <div key={domain} className="vs-source">
          <SiteBadge domain={domain} />
          <span className="vs-source-domain ellipsis">
            {sub && <span className="text-tint">*.</span>}
            {domain}
          </span>
          <Toggle
            variant="outline"
            size="sm"
            className="qs-regex"
            title={sub ? "Including subdomains" : "This site only"}
            pressed={sub}
            onPressedChange={() => onChange(toggleSubdomains(view, domain))}
          >
            *.
          </Toggle>
          <Button variant="ghost" size="icon" className="qs-icon-button" title="Remove" onClick={() => onChange(removeSource(view, domain))}>
            <CloseIcon />
          </Button>
        </div>
      ))}
      <div className="relative">
        <Input
          className="vs-add-site"
          aria-label="Add a site"
          placeholder="+ Add a site"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setDraft("");
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div className="vs-options" role="listbox">
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className="vs-option"
                // Before the field's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o.value);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <SiteBadge domain={o.value} small />
                <span className="ellipsis">{o.label}</span>
              </button>
            ))}
            {!options.length && <div className="vs-options-empty">Type a site, like example.com</div>}
          </div>
        )}
      </div>
    </section>
  );
}

function SiteBadge({ domain, small = false }: { domain: string; small?: boolean }) {
  const { letter, bg, fg } = siteBadge(domain);
  return (
    <span className={"vs-site-badge" + (small ? " small" : "")} style={{ background: bg, color: fg }}>
      {letter}
    </span>
  );
}
