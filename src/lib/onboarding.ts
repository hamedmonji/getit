// What the onboarding screens show: step 1's animation, frame by frame, step
// 2's map of the folders each access choice lets getit reach, and step 3's look.

import type { Accent, Background, ThemePreference } from "./appearance";

export type OnboardingStep = 1 | 2 | 3;
/** The steps as stored, to resume at after a restart. */
export const STORED_STEPS = ["1", "2", "3"] as const;
export type StoredStep = (typeof STORED_STEPS)[number];

/**
 * Whether onboarding shows at launch: where it's offered (macOS and Windows),
 * until getit knows where it can save, and then still on step 3, which comes
 * after that choice is saved.
 */
export function showsOnboarding(offered: boolean, accessChosen: boolean, step: StoredStep): boolean {
  return offered && (!accessChosen || step === "3");
}

/**
 * The steps onboarding goes through. Only macOS asks before an app reads
 * Desktop, Documents or Downloads, so elsewhere there's no access to choose
 * and step 2 is skipped.
 */
export function onboardingSteps(mac: boolean): OnboardingStep[] {
  return mac ? [1, 2, 3] : [1, 3];
}

/** The step a stored one resumes at: itself, or the first step when it's one this platform skips. */
export function resumeStep(steps: OnboardingStep[], stored: StoredStep): OnboardingStep {
  const step = Number(stored) as OnboardingStep;
  return steps.includes(step) ? step : steps[0];
}

/** The step after `step`, or null after the last. */
export function stepAfter(steps: OnboardingStep[], step: OnboardingStep): OnboardingStep | null {
  return steps[steps.indexOf(step) + 1] ?? null;
}

/** The step before `step`, or null before the first. */
export function stepBefore(steps: OnboardingStep[], step: OnboardingStep): OnboardingStep | null {
  const i = steps.indexOf(step);
  return i > 0 ? steps[i - 1] : null;
}

/** How a step heading counts: "Step 2 of 2" for step 3 when step 2 is skipped. */
export function stepLabel(steps: OnboardingStep[], step: OnboardingStep): string {
  return `Step ${steps.indexOf(step) + 1} of ${steps.length}`;
}

/** Step 3's theme choices, each drawn as a little window. */
export const THEME_THUMBS: Record<ThemePreference, string> = {
  Light: "linear-gradient(90deg, #efeee9 0 30%, #ffffff 30%)",
  Dark: "linear-gradient(90deg, #2a2a2a 0 30%, #343434 30%)",
  System: "linear-gradient(135deg, #ffffff 0 50%, #343434 50%)",
};

/** Step 3's background: the one chosen, or the accent's until one is. */
export function followedBackground(accent: Accent, chosen: Background | null): Background {
  return chosen ?? accent;
}

/** Step 1's animation advances one tick at a time. */
export const TICK_MS = 200;
/** Ticks in one loop of step 1's animation (6.4s). */
export const LOOP_TICKS = 32;

/** The ticks in a loop where things happen. */
const MENU = 4;
const PASTE_HOT = 7;
const ADD = 10;
const DONE = 15;
const FLASH_END = 19;
/** The tick shown when motion is reduced: the file in both windows, nothing highlighted. */
const STILL = 20;

const NEW_FILE = "cosmos_s01e03.mkv";
const NEW_SIZE_GB = 1.4;

export interface FinderRow {
  name: string;
  /** Nesting level: 0 at the top. */
  depth: number;
  folder: boolean;
  /** Whether a folder shows its contents. */
  open: boolean;
  size: string;
  /** False while the row is collapsed away. */
  shown: boolean;
  /** A download in progress, still under its partial name. */
  partial: boolean;
  /** Selected in Finder, as the finished file appears. */
  highlighted: boolean;
  /** A shaded stripe, counting only the rows shown. */
  striped: boolean;
}

export interface Tile {
  name: string;
  /** How much of the icon's preview is filled in, 0–100. */
  reveal: number;
  status: string;
  /** Progress 0–100 while downloading, else null. */
  progress: number | null;
  shown: boolean;
  highlighted: boolean;
}

export interface SameFoldersFrame {
  rows: FinderRow[];
  tiles: Tile[];
  menuOpen: boolean;
  /** Whether "Paste Link" is highlighted in the menu. */
  pasteHot: boolean;
  /** The pointer over getit's window, in px; null while hidden. */
  pointer: { x: number; y: number } | null;
  /** The moment the download finishes, when both windows highlight it. */
  flash: boolean;
  downloading: boolean;
}

/** A size as Finder writes it. */
export function finderSize(gb: number): string {
  if (gb <= 0) return "Zero KB";
  return gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`;
}

/** Where the pointer is at tick `q` of the loop, or null while it's hidden. */
function pointerAt(q: number): { x: number; y: number } | null {
  if (q < 1 || q >= ADD + 3) return null;
  if (q < 2) return { x: 230, y: 250 };
  if (q < MENU) return { x: 94, y: 148 };
  if (q < PASTE_HOT) return { x: 104, y: 160 };
  if (q <= ADD) return { x: 118, y: 164 };
  return { x: 230, y: 250 };
}

/**
 * Step 1 at `tick`: a link pasted in getit downloads into the folder, shows in
 * Finder under its partial name, and appears there as the file once done.
 * With `still`, the loop's resting state, for reduced motion.
 */
export function sameFoldersFrame(tick: number, still = false): SameFoldersFrame {
  const q = still ? STILL : ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
  const added = q >= ADD;
  const done = q >= DONE;
  const flash = done && q <= FLASH_END;
  const progress = !added ? 0 : done ? 100 : Math.round(((q - ADD) / (DONE - ADD)) * 100);
  const partial = added && !done;

  const listed = [
    { name: "Movies", depth: 0, folder: true, open: true, size: "--" },
    { name: "cosmos_s01e01.mkv", depth: 1, size: "1.3 GB" },
    { name: "cosmos_s01e02.mkv", depth: 1, size: "1.4 GB" },
    { name: NEW_FILE, depth: 1, size: `${NEW_SIZE_GB} GB`, isNew: true },
    { name: "Installers", depth: 0, folder: true, size: "--" },
    { name: "Papers", depth: 0, folder: true, size: "--" },
    { name: "Music", depth: 0, folder: true, size: "--" },
  ];
  let visible = 0;
  const rows = listed.map((r): FinderRow => {
    const shown = !r.isNew || added;
    const striped = shown && visible++ % 2 === 1;
    const isPartial = !!r.isNew && partial;
    return {
      name: isPartial ? `${r.name}.part` : r.name,
      depth: r.depth,
      folder: !!r.folder,
      open: !!r.open,
      size: isPartial ? finderSize((progress / 100) * NEW_SIZE_GB) : r.size,
      shown,
      partial: isPartial,
      highlighted: !!r.isNew && flash,
      striped,
    };
  });

  const finished = (name: string): Tile => ({
    name,
    reveal: 100,
    status: "Done",
    progress: null,
    shown: true,
    highlighted: false,
  });
  const tiles = [
    finished("cosmos_s01e01.mkv"),
    finished("cosmos_s01e02.mkv"),
    {
      name: NEW_FILE,
      reveal: progress,
      status: done ? "Done" : `${progress}% · 1.4 GB/s`,
      progress: partial ? progress : null,
      shown: added,
      highlighted: flash,
    },
  ];

  return {
    rows,
    tiles,
    menuOpen: q >= MENU && q < ADD,
    pasteHot: q >= PASTE_HOT && q < ADD,
    pointer: pointerAt(q),
    flash,
    downloading: partial,
  };
}

/** How getit gets into the folders macOS protects. */
export type AccessChoice = "full" | "folder";

export const ACCESS_COPY: Record<AccessChoice, { title: string; body: string; caption: string; action: string }> = {
  full: {
    title: "Full Disk Access",
    body: "Any folder, including external drives. Turned on in System Settings.",
    caption: "Every folder on your Mac can be a queue, on any drive.",
    action: "Open System Settings",
  },
  folder: {
    title: "One folder",
    body: "Only a folder you choose and the folders inside it.",
    caption: "Only the folder you choose and its folders can be queues. The rest stay locked until you allow them.",
    action: "Choose Folder…",
  },
};

/** How long after the one above each row changes, so the change sweeps down. */
const STAGGER_MS = 40;

export interface ReachRow {
  name: string;
  depth: number;
  open: boolean;
  items: number;
  reachable: boolean;
  delayMs: number;
}

export type SidebarEntry =
  | { kind: "header"; label: string }
  | { kind: "item"; label: string; selected: boolean; reachable: boolean; delayMs: number };

/** Step 2's Finder map: which folders getit can reach with `choice`, with Downloads as the example of one folder. */
export function accessMap(choice: AccessChoice): { rows: ReachRow[]; sidebar: SidebarEntry[] } {
  const full = choice === "full";
  const home = [
    { name: "Applications", depth: 0, items: 42 },
    { name: "Desktop", depth: 0, items: 8 },
    { name: "Documents", depth: 0, items: 126 },
    { name: "Downloads", depth: 0, items: 3, open: true, inDownloads: true },
    { name: "Movies", depth: 1, items: 12, inDownloads: true },
    { name: "ISOs", depth: 1, items: 4, inDownloads: true },
    { name: "Papers", depth: 1, items: 31, inDownloads: true },
    { name: "Music", depth: 0, items: 48 },
    { name: "Projects", depth: 0, items: 9 },
  ];
  const rows = home.map((r, i) => ({
    name: r.name,
    depth: r.depth,
    open: !!r.open,
    items: r.items,
    reachable: full || !!r.inDownloads,
    delayMs: i * STAGGER_MS,
  }));

  const side: ([string] | [string, boolean])[] = [
    ["Favorites"],
    ["Recents", false],
    ["Desktop", false],
    ["Documents", false],
    ["Downloads", true],
    ["Locations"],
    ["Macintosh HD", false],
    ["Media", false],
  ];
  const sidebar = side.map(([label, downloads], i): SidebarEntry =>
    downloads === undefined
      ? { kind: "header", label }
      : { kind: "item", label, selected: downloads, reachable: full || downloads, delayMs: i * STAGGER_MS },
  );
  return { rows, sidebar };
}

/**
 * How far to move a step's heading down so it starts level with the showcase
 * beside it, but only into the room the step has spare, so it never scrolls.
 * `headingTop` is where the heading sits without the offset; `spare` is the
 * empty room the step has now, with `offset` applied, and `overflow` how far
 * it runs past the window, so that a window made shorter takes the offset back.
 */
export function alignedOffset({
  showcaseTop,
  headingTop,
  spare,
  overflow = 0,
  offset,
}: {
  showcaseTop: number;
  headingTop: number;
  spare: number;
  overflow?: number;
  offset: number;
}): number {
  return Math.round(Math.max(0, Math.min(showcaseTop - headingTop, spare + offset - overflow)));
}

/**
 * Step 3's wave: on each pick, the preview's sidebar rows and then its tiles
 * bounce one after another as they take the new colours.
 */
export const WAVE = {
  /** How long one item's bounce takes, up and back. */
  bounceMs: 560,
  /** The gap between one item and the next. */
  stepMs: 70,
  /** The longest the wave may take from first to last item, however many. */
  spanMs: 490,
};

/** How long the whole wave takes, from the first item's start to the last one's end. */
export function waveLength(): number {
  return WAVE.spanMs + WAVE.bounceMs;
}

/** When each of `count` items in the wave starts, in ms, packed closer when there are many. */
export function waveDelays(count: number): number[] {
  if (count <= 0) return [];
  const step = count > 1 ? Math.min(WAVE.stepMs, WAVE.spanMs / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

/**
 * Step 3's finish: the window floods in the accent from the button, says
 * hello, and fades away to getit.
 */
export const FINISH = {
  /** Before the flood starts, so it starts from nothing. */
  startMs: 40,
  /** From the click until getit opens under the flood. */
  holdMs: 1500,
  /** How long the flood takes to fade away over getit. */
  fadeMs: 450,
};

/** What the finish says. */
export const FINISH_TITLE = "Let's Get it";
