import { useId, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ACCENT_PRESET_IDS,
  ACCENT_PRESETS,
  accentColor,
  DENSITIES,
  DENSITY_LABELS,
  isPreset,
  THEME_PREFERENCES,
  type Accent,
  type Density,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/appearance";
import { displayPath } from "../lib/paths";
import { SETTINGS_PAGE_LABELS, settingsPages } from "../lib/settingsPages";
import { SORT_LABELS, type SortKey } from "../lib/sort";
import { GripIcon } from "./icons";

/** What the Folder access section shows and does, on macOS. */
export interface AccessSettings {
  home: string;
  fullDisk: boolean;
  /** Whether the user already went to turn on Full Disk Access. */
  asked: boolean;
  /** The folder chosen on first launch, if any. */
  root: string | null;
  /** Folders added here since. */
  folders: string[];
  onFullDiskAccess: () => void;
  onRestart: () => void;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
}

/** What the Appearance page shows and changes. */
export interface AppearanceSettings {
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  /** The theme in use, for showing each accent as it looks now. */
  resolvedTheme: ResolvedTheme;
  accent: Accent;
  onAccent: (accent: Accent) => void;
  density: Density;
  onDensity: (density: Density) => void;
}

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * The settings dialog, centred over the app, with settings that apply
 * everywhere, on pages picked in a sidebar: the sort order, where files are sorted by the top
 * key, then the next for ties; and whether pasted links are added without
 * asking; how getit looks; on macOS, Full Disk Access and the folders getit may open without
 * it. In development, a way to see onboarding again. Closes on a click
 * outside it or Escape.
 */
export function Settings({
  open,
  sortOrder,
  onSortOrder,
  pasteMode,
  onPasteMode,
  appearance,
  access,
  onResetOnboarding,
  onClose,
}: {
  open: boolean;
  sortOrder: SortKey[];
  onSortOrder: (order: SortKey[]) => void;
  pasteMode: "ask" | "always";
  onPasteMode: (mode: "ask" | "always") => void;
  appearance: AppearanceSettings;
  /** The Folder access section shows only when given. */
  access?: AccessSettings;
  /** Forgets the first-launch choice and restarts getit; the section shows only when given. */
  onResetOnboarding?: () => void;
  onClose: () => void;
}) {
  const askId = useId();
  const pages = settingsPages({ access: !!access, development: !!onResetOnboarding });
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      {/* The pages describe themselves; there's no one description for the dialog. */}
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(520px,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-2xl [&_[data-slot=dialog-close]]:text-ink-muted"
      >
        <Tabs defaultValue="general" orientation="vertical" className="min-h-0 flex-1 gap-0">
          <div className="flex w-44 flex-none flex-col gap-3 border-r border-line bg-panel2 p-3">
            <DialogHeader className="px-2 pt-1">
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <TabsList className="w-full items-stretch gap-0.5 bg-transparent p-0">
              {pages.map((page) => (
                <TabsTrigger key={page} value={page} className="h-8 flex-none px-2">
                  {SETTINGS_PAGE_LABELS[page]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="general" className="min-h-0 overflow-y-auto p-5 pt-12">
            <section className="settings-section">
              <h3 className="settings-heading">Sort files by</h3>
              <SortList order={sortOrder} onChange={onSortOrder} />
              <p className="settings-note">
                Sorted by the first, then by the next where they're equal. Drag to reorder, or click one to put it
                first. This doesn't change the order downloads run in.
              </p>
            </section>
            <section className="settings-section">
              <h3 className="settings-heading">Pasted links</h3>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={askId}
                  checked={pasteMode === "ask"}
                  onCheckedChange={(checked) => onPasteMode(checked === true ? "ask" : "always")}
                />
                <Label htmlFor={askId}>Ask before adding pasted links</Label>
              </div>
              <p className="settings-note">When off, pasted links go straight into the current folder's queue.</p>
            </section>
          </TabsContent>
          <TabsContent value="appearance" className="min-h-0 overflow-y-auto p-5 pt-12">
            <Appearance {...appearance} />
          </TabsContent>
          {access && (
            <TabsContent value="access" className="min-h-0 overflow-y-auto p-5 pt-12">
              <FolderAccess {...access} />
            </TabsContent>
          )}
          {onResetOnboarding && (
            <TabsContent value="development" className="min-h-0 overflow-y-auto p-5 pt-12">
              <section className="settings-section">
                <h3 className="settings-heading">Onboarding</h3>
                <div>
                  <Button variant="outline" size="sm" onClick={onResetOnboarding}>
                    Reset onboarding and restart
                  </Button>
                </div>
                <p className="settings-note">Forgets the first-launch choice, so onboarding shows again.</p>
              </section>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** The theme, accent colour and density. */
function Appearance(a: AppearanceSettings) {
  const custom = isPreset(a.accent) ? null : a.accent;
  return (
    <>
      <section className="settings-section">
        <h3 className="settings-heading">Theme</h3>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={a.theme}
          onValueChange={(v) => v && a.onTheme(v as ThemePreference)}
        >
          {THEME_PREFERENCES.map((theme) => (
            <ToggleGroupItem key={theme} value={theme} className="px-3">
              {theme}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="settings-note">System follows macOS as it switches between light and dark.</p>
      </section>
      <section className="settings-section">
        <h3 className="settings-heading">Accent color</h3>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            spacing={2}
            value={custom ? "" : a.accent}
            onValueChange={(v) => v && a.onAccent(v as Accent)}
          >
            {ACCENT_PRESET_IDS.map((id) => (
              <ToggleGroupItem
                key={id}
                value={id}
                aria-label={ACCENT_PRESETS[id].label}
                title={ACCENT_PRESETS[id].label}
                className="accent-swatch"
                style={{ background: accentColor(id, a.resolvedTheme) }}
              />
            ))}
          </ToggleGroup>
          {/* No shadcn colour picker; the system's opens from this swatch. */}
          <label
            className="accent-swatch accent-custom"
            data-state={custom ? "on" : "off"}
            title="Custom color"
            style={custom ? { background: custom } : undefined}
          >
            <input
              type="color"
              aria-label="Custom color"
              value={custom ?? "#888888"}
              onChange={(e) => a.onAccent(e.target.value.toLowerCase() as Accent)}
            />
          </label>
        </div>
        <p className="settings-note">
          Colors selections, progress and folders. Custom colors are used as they are in light and dark mode.
        </p>
      </section>
      <section className="settings-section">
        <h3 className="settings-heading">Density</h3>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={a.density}
          onValueChange={(v) => v && a.onDensity(v as Density)}
        >
          {DENSITIES.map((density) => (
            <ToggleGroupItem key={density} value={density} className="px-3">
              {DENSITY_LABELS[density]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="settings-note">Compact fits more files on screen, in both icon and list views.</p>
      </section>
    </>
  );
}

/** Full Disk Access, and without it, the folders getit may open. */
function FolderAccess(a: AccessSettings) {
  return (
    <section className="settings-section">
      <h3 className="settings-heading">Folder access</h3>
      <Item variant="outline" size="sm">
        <ItemContent>
          <ItemTitle>Full Disk Access</ItemTitle>
          <ItemDescription>
            {a.fullDisk ? "On. getit can open every folder." : "Off. getit can open only the folders below."}
          </ItemDescription>
        </ItemContent>
        {!a.fullDisk && (
          <ItemActions>
            <Button variant={a.asked ? "outline" : "default"} size="sm" onClick={a.onFullDiskAccess}>
              Open System Settings
            </Button>
            {a.asked && (
              <Button size="sm" onClick={a.onRestart}>
                Restart getit
              </Button>
            )}
          </ItemActions>
        )}
      </Item>
      {a.asked && !a.fullDisk && (
        <p className="settings-note">
          Add getit to the Full Disk Access list and turn it on, then restart getit so macOS lets it in.
        </p>
      )}
      {!a.fullDisk && (
        <>
          <ItemGroup className="mt-3 gap-1">
            {a.root && (
              <Item variant="outline" size="xs">
                <ItemContent>
                  <ItemTitle title={a.root}>{displayPath(a.root, a.home)}</ItemTitle>
                </ItemContent>
                <ItemActions className="text-xs text-ink-muted">Opens here</ItemActions>
              </Item>
            )}
            {a.folders.map((path) => (
              <Item key={path} variant="outline" size="xs">
                <ItemContent>
                  <ItemTitle title={path}>{displayPath(path, a.home)}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="xs" onClick={() => a.onRemoveFolder(path)}>
                    Remove
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={a.onAddFolder}>
              Add Folder…
            </Button>
          </div>
          <p className="settings-note">
            getit can open these folders and the ones inside them. Desktop, Documents and Downloads stay locked
            outside them.
          </p>
        </>
      )}
    </section>
  );
}

/** Reorderable list: drag a row up or down, or click it to move it to the top. */
function SortList({ order, onChange }: { order: SortKey[]; onChange: (order: SortKey[]) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  // The press being tracked: which key, where it started, and whether it became a drag.
  const press = useRef<{ key: SortKey; y: number; dragging: boolean } | null>(null);
  const [dragging, setDragging] = useState<SortKey | null>(null);

  /** The index the pointer at `y` is over, from the rows' positions. */
  const indexAt = (y: number) => {
    const rows = [...(listRef.current?.children ?? [])];
    const i = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? rows.length - 1 : i;
  };

  const moveTo = (key: SortKey, index: number) => {
    const rest = order.filter((k) => k !== key);
    const next = [...rest.slice(0, index), key, ...rest.slice(index)];
    if (next.some((k, i) => k !== order[i])) onChange(next);
  };

  const onPointerDown = (key: SortKey, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { key, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.dragging) {
      p.dragging = true;
      setDragging(p.key);
    }
    moveTo(p.key, indexAt(e.clientY));
  };
  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    setDragging(null);
    if (p && !p.dragging) moveTo(p.key, 0);
  };

  return (
    <ol className="sort-list" ref={listRef}>
      {order.map((key, i) => (
        <Item
          key={key}
          asChild
          variant="outline"
          size="xs"
          className={"touch-none " + (dragging === key ? "cursor-grabbing shadow-md" : "cursor-grab")}
        >
          <li
            title={i === 0 ? "Sorted by this first" : "Click to sort by this first"}
            onPointerDown={(e) => onPointerDown(key, e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <span className="sort-rank">{i + 1}</span>
            <ItemContent>
              <ItemTitle>{SORT_LABELS[key]}</ItemTitle>
            </ItemContent>
            <ItemActions className="text-ink-muted">
              <GripIcon />
            </ItemActions>
          </li>
        </Item>
      ))}
    </ol>
  );
}
