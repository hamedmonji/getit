import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAlignedOffset } from "../hooks/useAlignedOffset";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  accentOptions,
  backgroundOptions,
  floodColor,
  isPreset,
  THEME_PREFERENCES,
  type Accent,
  type Background,
  type ThemePreference,
} from "../lib/appearance";
import {
  ACCESS_COPY,
  accessMap,
  FINISH,
  followedBackground,
  sameFoldersFrame,
  stepAfter,
  stepBefore,
  stepLabel,
  THEME_THUMBS,
  TICK_MS,
  type AccessChoice,
  type OnboardingStep,
  type FinderRow,
  type SidebarEntry,
  type Tile,
} from "../lib/onboarding";
import { FILE_MANAGER, IS_MAC, IS_WINDOWS, MOD } from "../lib/platform";
import { CaptionGlyphs, ExplorerRowName, ExplorerWindow, STEP1_PLACES } from "./ExplorerArt";
import { WindowControls } from "./WindowControls";
import { AppearancePreview } from "./AppearancePreview";
import { ColorSwatches } from "./ColorSwatches";
import { FinishFlood } from "./FinishFlood";
import { FileIcon } from "./FileIcon";
import type { AppearanceSettings } from "./Settings";

// Windows' buttons are square-cornered, in its own size.
const shape = IS_WINDOWS ? "h-8 rounded-[4px] text-sm" : "h-[34px] rounded-lg text-[13px]";
const primary = cn(shape, "bg-(--ob-accent) px-4 font-semibold text-white hover:bg-(--ob-accent-hover)");
const secondary = cn(shape, "border-line bg-panel px-3.5 text-ink");
/** The file manager by its full name, as step 1 says it. */
const FILE_MANAGER_NAME = IS_WINDOWS ? "File Explorer" : FILE_MANAGER;

/**
 * First launch. Fills the window in place of the app until the user finishes.
 * Step 1 shows that getit's folders are the file manager's; step 2 asks for
 * Full Disk Access or one folder, on macOS only, which protects Desktop,
 * Documents and Downloads; step 3 sets how getit looks, on getit itself.
 */
export function Onboarding({
  steps,
  step,
  onStep,
  home,
  asked,
  onFullDiskAccess,
  onChooseFolder,
  error,
  appearance,
  onFinish,
}: {
  /** The steps this platform goes through, in order. */
  steps: OnboardingStep[];
  step: OnboardingStep;
  onStep: (step: OnboardingStep) => void;
  /** The home folder's name, as Finder titles it. */
  home: string;
  /** Whether the user already went to turn on Full Disk Access. */
  asked: boolean;
  onFullDiskAccess: () => void;
  onChooseFolder: () => void;
  /** What went wrong with the last choice, if anything. */
  error: string | null;
  appearance: LookSettings;
  /** Leaves onboarding for the app; `flooded` when the finish filled the window, to fade away over getit. */
  onFinish: (flooded: boolean) => void;
}) {
  return (
    // Step 3 keeps to plain greys, so only the preview shows the picked colours.
    <div className={cn("relative flex h-screen flex-col text-ink", step === 3 ? "bg-(--ob-plain)" : "bg-panel")}>
      {IS_WINDOWS ? (
        // getit draws its own title bar on Windows, so setup has one too, with the window's buttons.
        <div data-tauri-drag-region className="flex h-8 flex-none items-center gap-2.5 pl-3.5 text-xs">
          <span className="grid size-4 place-items-center rounded bg-(--ob-accent)" aria-hidden>
            <svg width="10" height="10" viewBox="0 0 16 16">
              <path d="M8 2v9m-4-4 4 4 4-4M3 14h10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span data-tauri-drag-region>getit setup</span>
          <div className="ml-auto h-full">
            <WindowControls />
          </div>
        </div>
      ) : (
        /* The window's bar: no bar of its own, so the page runs up under the
           window's buttons, but something to drag the window by. As tall as
           the app's toolbar, where the buttons are placed. */
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-12" />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {step === 1 ? (
            <SameFolders label={stepLabel(steps, 1)} onContinue={() => onStep(stepAfter(steps, 1) ?? 1)} />
          ) : step === 3 ? (
            <PickALook
              {...appearance}
              label={stepLabel(steps, 3)}
              onBack={() => onStep(stepBefore(steps, 3) ?? 3)}
              onFinish={onFinish}
            />
          ) : (
            <WhereToSave
              label={stepLabel(steps, 2)}
              home={home}
              asked={asked}
              error={error}
              onBack={() => onStep(1)}
              onFullDiskAccess={onFullDiskAccess}
              onChooseFolder={onChooseFolder}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A step's heading under its count, such as "Step 1 of 3". */
function StepHeading({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[11px] text-ink-muted">{label}</div>
      <h1 className="text-2xl font-bold tracking-[-0.025em]">{title}</h1>
      <p className="max-w-[600px] text-[13.5px] leading-normal text-pretty text-ink-muted">{children}</p>
    </div>
  );
}

// Step 1

function SameFolders({ label, onContinue }: { label: string; onContinue: () => void }) {
  const still = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [still]);
  const frame = sameFoldersFrame(tick, still);

  return (
    <>
      <div className="flex flex-1 items-center justify-center bg-(--ob-soft) p-7">
        <div className="grid w-full max-w-[1000px] grid-cols-[minmax(0,1.25fr)_32px_minmax(0,1fr)] items-center">
        {IS_WINDOWS ? (
          <ExplorerWindow title="Downloads" height={300} places={STEP1_PLACES} column="Size" columnWidth={60}>
            {frame.rows.map((row) => (
              <DownloadRow key={row.depth + row.name.replace(/\.part$/, "")} row={row} explorer />
            ))}
          </ExplorerWindow>
        ) : (
          <FinderWindow title="Downloads" height={300} sidebar={STEP1_SIDEBAR} column="Size" columnWidth={60}>
            {frame.rows.map((row) => (
              <DownloadRow key={row.depth + row.name.replace(/\.part$/, "")} row={row} />
            ))}
          </FinderWindow>
        )}
        <div className="grid place-items-center">
          <span
            className={cn(
              "grid size-[26px] place-items-center rounded-full text-[15px] font-bold transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(.3,1.6,.5,1)]",
              frame.flash ? "scale-130 bg-(--ob-accent) text-white" : "bg-panel text-(--ob-accent)",
            )}
          >
            =
          </span>
        </div>
        <GetitWindow tiles={frame.tiles} frame={frame} />
        </div>
      </div>
      <div className="flex flex-none items-end gap-6 border-t border-line px-8 pt-[26px] pb-6">
        <div className="flex-1">
          <StepHeading label={label} title="Same folders, now with downloads">
            getit opens the folders you already have in {FILE_MANAGER_NAME}. Downloads land right inside them, and{" "}
            {FILE_MANAGER_NAME} sees each file the moment it's done.
          </StepHeading>
        </div>
        <Button className={primary} onClick={onContinue} autoFocus>
          Continue
        </Button>
      </div>
    </>
  );
}

const STEP1_SIDEBAR: SidebarEntry[] = [
  { kind: "header", label: "Favorites" },
  ...["Recents", "Applications", "Desktop", "Documents", "Downloads"].map(
    (label): SidebarEntry => ({ kind: "item", label, selected: label === "Downloads", reachable: true, delayMs: 0 }),
  ),
  { kind: "header", label: "Locations" },
  { kind: "item", label: "Media", selected: false, reachable: true, delayMs: 0 },
];

/** A row of step 1's file manager list, in Finder's look or, with `explorer`, File Explorer's. */
function DownloadRow({ row, explorer = false }: { row: FinderRow; explorer?: boolean }) {
  const name = { depth: row.depth, folder: row.folder, open: row.open, name: row.name };
  return (
    <div
      className="overflow-hidden transition-[height,opacity] duration-300"
      style={{ height: row.shown ? 24 : 0, opacity: row.partial ? 0.45 : 1 }}
    >
      <div
        className={cn(
          "mx-1.5 grid h-6 grid-cols-[minmax(0,1fr)_60px] items-center px-2.5 transition-colors duration-400",
          explorer ? "rounded text-[11.5px]" : "rounded-[5px] text-xs",
          row.highlighted
            ? "bg-[#0a64d6] text-white"
            : explorer
              ? row.striped
                ? "bg-(--explorer-stripe)"
                : "bg-(--explorer-bg)"
              : row.striped
                ? "bg-(--finder-stripe)"
                : "bg-(--finder-bg)",
        )}
      >
        {explorer ? <ExplorerRowName {...name} /> : <RowName {...name} />}
        <span
          className={cn(
            "text-right",
            row.highlighted ? "text-white" : explorer ? "text-(--explorer-sub)" : "text-(--finder-sub)",
          )}
        >
          {row.size}
        </span>
      </div>
    </div>
  );
}

function GetitWindow({ tiles, frame }: { tiles: Tile[]; frame: ReturnType<typeof sameFoldersFrame> }) {
  return (
    <div className="relative flex h-[300px] flex-col overflow-hidden rounded-[10px] border border-line bg-panel text-ink shadow-[0_10px_28px_color-mix(in_oklch,var(--ob-accent)_16%,transparent)]">
      <div className={cn("flex h-11 flex-none items-center gap-2 border-b border-line", IS_WINDOWS ? "pl-2.5" : "px-2.5")}>
        <div className="flex h-[26px] min-w-0 flex-1 items-center gap-1 rounded-lg border border-line bg-panel2 px-2 font-mono text-[11px] whitespace-nowrap">
          <span className="text-ink-muted">{IS_WINDOWS ? "Downloads \\" : "~ / Downloads /"}</span>
          <span className="font-semibold">Movies</span>
        </div>
        {/* getit's own caption buttons on Windows, where the Mac's sit in Finder's window. */}
        {IS_WINDOWS && <CaptionGlyphs width={30} height={44} />}
      </div>
      <div className="grid flex-1 grid-cols-3 content-start gap-1 px-2 py-4">
        {tiles.map((tile) => (
          <div
            key={tile.name}
            className="flex min-w-0 flex-col items-center gap-1.5 rounded-[10px] px-0.5 py-2.5 transition-[background-color,box-shadow,opacity,transform] duration-300"
            style={{
              opacity: tile.shown ? 1 : 0,
              transform: tile.shown ? "scale(1)" : "scale(.85)",
              background: tile.highlighted ? "var(--ob-soft)" : "transparent",
              boxShadow: tile.highlighted ? "0 0 0 2px var(--ob-accent)" : "none",
            }}
          >
            <div className="size-12">
              <FileIcon kind="video" ext="MKV" hue={215} reveal={tile.reveal} />
            </div>
            <span className="max-w-full truncate text-[11px]">{tile.name}</span>
            <div
              className="h-[3px] w-14 overflow-hidden rounded-sm bg-track"
              style={{ opacity: tile.progress === null ? 0 : 1 }}
            >
              <div className="h-full bg-(--ob-accent) transition-[width] duration-200 ease-linear" style={{ width: `${tile.progress ?? 100}%` }} />
            </div>
            <span className="-mt-0.5 font-mono text-[10px] whitespace-nowrap text-ink-muted">{tile.status}</span>
          </div>
        ))}
      </div>
      <PasteMenu open={frame.menuOpen} hot={frame.pasteHot} />
      <Pointer at={frame.pointer} />
      <div className="flex h-[30px] flex-none items-center gap-1.5 border-t border-line px-3 text-[11.5px] text-ink-muted">
        <span className={cn("size-[7px] rounded-full", frame.downloading ? "bg-(--ob-accent)" : "bg-(--ob-success)")} />
        {frame.downloading ? "1 downloading" : "Up to date"}
      </div>
    </div>
  );
}

/** getit's menu for a folder's empty space, as drawn in the animation. */
function PasteMenu({ open, hot }: { open: boolean; hot: boolean }) {
  const items: ([string, string, boolean] | null)[] = [
    ["Paste Link", `${MOD}V`, hot],
    ["New Folder", IS_MAC ? "⇧⌘N" : "Ctrl+Shift+N", false],
    null,
    ["Queue Settings…", "", false],
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-[150px] left-[96px] z-3 flex w-[168px] origin-top-left flex-col rounded-lg border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(20,20,20,.16)] transition-[opacity,transform] duration-120"
      style={{ opacity: open ? 1 : 0, transform: open ? "scale(1)" : "scale(.96)" }}
    >
      {items.map((item, i) =>
        item ? (
          <div
            key={i}
            className={cn(
              "flex h-[26px] items-center rounded-[5px] px-2 text-xs transition-colors duration-100",
              item[2] ? "bg-(--ob-accent) text-white" : "text-ink",
            )}
          >
            <span className="flex-1">{item[0]}</span>
            <span className={cn("font-mono text-[10.5px]", item[2] ? "text-white" : "text-ink-muted")}>{item[1]}</span>
          </div>
        ) : (
          <div key={i} className="mx-1.5 my-1 h-px bg-line" />
        ),
      )}
    </div>
  );
}

function Pointer({ at }: { at: { x: number; y: number } | null }) {
  // Stays where it was while hidden, so it fades rather than flies away.
  const [last, setLast] = useState({ x: 230, y: 250 });
  useEffect(() => {
    if (at) setLast(at);
  }, [at?.x, at?.y]);
  const pos = at ?? last;
  return (
    <svg
      aria-hidden
      width="16"
      height="20"
      viewBox="0 0 16 20"
      className="pointer-events-none absolute top-0 left-0 z-4 transition-[transform,opacity] duration-500 ease-[cubic-bezier(.4,0,.2,1)]"
      style={{ opacity: at ? 1 : 0, transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      <path d="M1.5 1.5v14.5l3.6-3.4 2.4 5.4 2.6-1.1-2.4-5.3h5z" fill="#1c1b19" stroke="#ffffff" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

// Step 2

function WhereToSave({
  label,
  home,
  asked,
  error,
  onBack,
  onFullDiskAccess,
  onChooseFolder,
}: {
  label: string;
  home: string;
  asked: boolean;
  error: string | null;
  onBack: () => void;
  onFullDiskAccess: () => void;
  onChooseFolder: () => void;
}) {
  const [choice, setChoice] = useState<AccessChoice>("full");
  const { rows, sidebar } = accessMap(choice);
  const copy = ACCESS_COPY[choice];
  const align = useAlignedOffset();

  return (
    <div className="grid flex-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div
        className="flex items-center justify-center px-6 py-7 transition-colors duration-300"
        style={{ background: choice === "full" ? "var(--ob-soft-strong)" : "var(--ob-soft)" }}
      >
        <div ref={align.showcase} className="flex w-full max-w-[520px]">
        <FinderWindow title={home} height={340} sidebar={sidebar} column="Items" columnWidth={46}>
          {rows.map((row, i) => (
            <div
              key={row.name}
              className={cn(
                "mx-1.5 grid h-6 grid-cols-[minmax(0,1fr)_46px] items-center rounded-[5px] px-2.5 text-xs transition-opacity duration-300",
                i % 2 ? "bg-(--finder-stripe)" : "bg-(--finder-bg)",
              )}
              style={{ opacity: row.reachable ? 1 : 0.42, transitionDelay: `${row.delayMs}ms` }}
            >
              <RowName depth={row.depth} folder open={row.open} name={row.name}>
                {!row.reachable && <Lock />}
                <QueueDot shown={row.reachable} delayMs={row.delayMs} />
              </RowName>
              <span className="text-right text-(--finder-sub)">{row.items}</span>
            </div>
          ))}
        </FinderWindow>
        </div>
      </div>
      <div
        ref={align.column}
        className="flex max-w-[520px] flex-col gap-5 px-8 pb-[26px]"
        style={{ paddingTop: 32 + align.offset }}
      >
        <StepHeading label={label} title="Where can getit save files?">
          {copy.caption}
        </StepHeading>
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as AccessChoice)} className="gap-2">
          {(["full", "folder"] as const).map((key) => (
            <label
              key={key}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-xl px-3.5 py-3 transition-colors duration-200 hover:border-(--ob-accent)",
                choice === key ? "border-[1.5px] border-(--ob-accent) bg-(--ob-soft)" : "border border-line",
              )}
            >
              <RadioGroupItem
                value={key}
                className="mt-0.5 border-[1.5px] border-ink-muted bg-panel data-checked:border-[5px] data-checked:border-(--ob-accent) data-checked:bg-panel dark:bg-panel dark:data-checked:bg-panel [&_[data-slot=radio-group-indicator]]:hidden"
              />
              <span className="flex flex-col gap-[3px]">
                <span className="text-sm font-semibold">{ACCESS_COPY[key].title}</span>
                <span className="text-[12.5px] leading-[1.45] text-ink-muted">{ACCESS_COPY[key].body}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {asked && choice === "full" && (
          <p className="text-[12.5px] leading-[1.45] text-ink-muted">
            Add getit to the list and turn it on. getit continues once it can get in; if macOS asks, choose Quit &amp;
            Reopen and getit picks up here.
          </p>
        )}
        {error && <p className="text-[12.5px] leading-[1.45] text-destructive">{error}</p>}
        <div ref={align.filler} className="flex-1" />
        <div className="flex items-center justify-end gap-2.5">
          <Button variant="outline" className={secondary} onClick={onBack}>
            Back
          </Button>
          <Button className={primary} onClick={choice === "full" ? onFullDiskAccess : onChooseFolder}>
            {copy.action}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Step 3

/** What step 3 changes: the theme, accent and background colours. */
export type LookSettings = Pick<
  AppearanceSettings,
  "theme" | "onTheme" | "resolvedTheme" | "accent" | "onAccent" | "background" | "onBackground"
>;

function PickALook({
  theme,
  onTheme,
  resolvedTheme,
  accent,
  onAccent,
  background,
  onBackground,
  label,
  onBack,
  onFinish,
}: LookSettings & { label: string; onBack: () => void; onFinish: (flooded: boolean) => void }) {
  const still = useReducedMotion();
  // Goes up with each pick, for the preview to wave.
  const [wave, setWave] = useState(0);
  const waved = () => {
    if (!still) setWave((n) => n + 1);
  };
  // The background follows the accent until one is picked here.
  const [chosen, setChosen] = useState<Background | null>(null);
  const pickAccent = (next: Accent) => {
    onAccent(next);
    onBackground(followedBackground(next, chosen));
    waved();
  };
  // Where the finish floods from: the button's centre, once it's clicked.
  const [flood, setFlood] = useState<{ x: number; y: number } | null>(null);
  const finish = (button: HTMLElement) => {
    if (still) return onFinish(false);
    if (flood) return;
    const r = button.getBoundingClientRect();
    setFlood({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  useEffect(() => {
    if (!flood) return;
    const timer = setTimeout(() => onFinish(true), FINISH.holdMs);
    return () => clearTimeout(timer);
  }, [flood]);
  useEffect(() => {
    if (background !== accent) onBackground(followedBackground(accent, null));
  }, []);
  const align = useAlignedOffset();

  return (
    <div className="grid flex-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex items-center justify-center bg-(--ob-stage) px-6 py-7">
        <div ref={align.showcase} className="w-full">
          <AppearancePreview wave={wave} />
        </div>
      </div>
      <div
        ref={align.column}
        className="flex max-w-[520px] flex-col gap-5 px-8 pb-[26px]"
        style={{ paddingTop: 32 + align.offset }}
      >
        <StepHeading label={label} title="Pick a look">
          You can change this any time in Settings › Appearance.
        </StepHeading>
        <LookSection title="Theme">
          <ToggleGroup
            type="single"
            spacing={2}
            value={theme}
            onValueChange={(v) => {
              if (!v) return;
              onTheme(v as ThemePreference);
              waved();
            }}
            className="grid w-full grid-cols-3"
          >
            {THEME_PREFERENCES.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="look-theme flex h-auto flex-col gap-1.5 rounded-[10px] border border-line p-2 pb-[7px] text-[12.5px] font-medium"
              >
                <span
                  className="h-9 w-full rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)]"
                  style={{ background: THEME_THUMBS[option] }}
                />
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </LookSection>
        <LookSection title="Accent">
          <ColorSwatches
            options={accentOptions(resolvedTheme)}
            value={accent}
            onChange={(v) => pickAccent(v as Accent)}
            custom={false}
          />
        </LookSection>
        <LookSection title="Background" note={chosen === null && isPreset(background) ? "Follows accent" : undefined}>
          <ColorSwatches
            options={backgroundOptions("Neutral")}
            value={background}
            onChange={(v) => {
              setChosen(v as Background);
              onBackground(v as Background);
              waved();
            }}
            custom={false}
          />
        </LookSection>
        <div ref={align.filler} className="flex-1" />
        <div className="flex items-center justify-end gap-2.5">
          <Button variant="outline" className={cn(secondary, "bg-(--ob-plain)")} onClick={onBack}>
            Back
          </Button>
          <Button className={primary} onClick={(e) => finish(e.currentTarget)} autoFocus>
            Done
          </Button>
        </div>
      </div>
      {flood && <FinishFlood color={floodColor(accent)} phase="flood" origin={flood} />}
    </div>
  );
}

function LookSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold">{title}</h2>
        {note && <span className="text-xs text-ink-muted">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function QueueDot({ shown, delayMs }: { shown: boolean; delayMs: number }) {
  return (
    <span
      className="size-[7px] flex-none rounded-full bg-(--ob-accent) transition-transform duration-300 ease-[cubic-bezier(.3,1.6,.5,1)]"
      style={{ transform: shown ? "scale(1)" : "scale(0)", transitionDelay: `${delayMs}ms` }}
    />
  );
}

// The Finder look-alike: simple shapes, no Apple artwork.

function FinderWindow({
  title,
  height,
  sidebar,
  column,
  columnWidth,
  children,
}: {
  title: string;
  height: number;
  sidebar: SidebarEntry[];
  /** The list's second column. */
  column: string;
  columnWidth: number;
  children: ReactNode;
}) {
  const columns: CSSProperties = { gridTemplateColumns: `minmax(0,1fr) ${columnWidth}px` };
  return (
    <div
      aria-hidden
      className="finder-art flex min-w-0 flex-1 overflow-hidden rounded-[10px] border border-(--finder-border) bg-(--finder-bg) shadow-[0_10px_28px_rgba(0,0,0,.14),0_0_0_.5px_rgba(0,0,0,.08)]"
      style={{ height }}
    >
      <div className="flex w-[124px] flex-none flex-col gap-px border-r border-(--finder-line) bg-(--finder-sidebar) px-2 py-3">
        <div className="flex gap-[7px] px-1 pb-3.5">
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span key={color} className="size-[11px] rounded-full shadow-[inset_0_0_0_.5px_rgba(0,0,0,.15)]" style={{ background: color }} />
          ))}
        </div>
        {sidebar.map((entry, i) =>
          entry.kind === "header" ? (
            <div key={i} className={cn("px-2 pb-1 text-[10.5px] font-semibold text-(--finder-head)", i > 0 && "pt-3")}>
              {entry.label}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "flex h-6 items-center gap-[7px] rounded-[5px] px-2 text-xs transition-opacity duration-300",
                entry.selected && "bg-(--finder-selected)",
              )}
              style={{ opacity: entry.reachable ? 1 : 0.42, transitionDelay: `${entry.delayMs}ms` }}
            >
              <span className="finder-folder h-[11px] w-3.5">
                <span />
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {!entry.reachable && <Lock />}
            </div>
          ),
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 flex-none items-center gap-2.5 border-b border-(--finder-line) px-3">
          <svg width="10" height="12" viewBox="0 0 10 12">
            <path d="M7 1L2 6l5 5" fill="none" stroke="var(--finder-sub)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg width="10" height="12" viewBox="0 0 10 12">
            <path d="M3 1l5 5-5 5" fill="none" stroke="var(--finder-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate text-[13px] font-bold">{title}</span>
        </div>
        <div className="grid h-[22px] flex-none items-center border-b border-(--finder-line) px-4 text-[11px] text-(--finder-sub)" style={columns}>
          <span className="pl-[18px]">Name</span>
          <span className="text-right">{column}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pt-0.5">{children}</div>
      </div>
    </div>
  );
}

function RowName({
  depth,
  folder,
  open,
  name,
  children,
}: {
  depth: number;
  folder: boolean;
  open: boolean;
  name: string;
  children?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
      <span className="grid w-2.5 flex-none place-items-center text-(--finder-head)">
        {folder && (
          <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M2 1l4 3-4 3z" fill="currentColor" />
          </svg>
        )}
      </span>
      {folder ? (
        <span className="finder-folder h-[13px] w-4">
          <span />
        </span>
      ) : (
        <span className="mx-0.5 h-[15px] w-3 flex-none rounded-[2px] border border-(--finder-faint) [background:var(--finder-file)]" />
      )}
      <span className="truncate">{name}</span>
      {children}
    </span>
  );
}

function Lock() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" className="flex-none">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="var(--finder-head)" strokeWidth="1.6" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="var(--finder-head)" strokeWidth="1.6" />
    </svg>
  );
}
