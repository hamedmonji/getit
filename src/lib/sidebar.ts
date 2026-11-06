// The sidebar: the places getit may open at the top, then the user's favorites.

import { moveTo } from "./batch";
import { isFolderKey } from "./keys";
import { baseName, isAbsolutePath, isWithin, relocateAll, type Move } from "./paths";

export interface Drive {
  name: string;
  path: string;
}

/** A place in the sidebar: a folder to go to, or a file to open. */
export interface Place {
  name: string;
  path: string;
  file: boolean;
}

/** A pinned folder or file, kept across restarts. */
export interface Favorite {
  path: string;
  file: boolean;
}

/** What a sidebar drop target is called: a gap in the favorites to pin items at. */
const SLOT = "favorites:";

/** The `data-drop` name for the gap before favorite `index` (or the end). */
export const favoriteSlot = (index: number) => SLOT + index;

/** The favorites index a `data-drop` name pins at, or null for a folder. */
export function slotIndex(target: string): number | null {
  if (!target.startsWith(SLOT)) return null;
  const index = Number(target.slice(SLOT.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** What dragging a favorite in the sidebar carries, told apart from items in a folder. */
const DRAGGED = "favorite:";

export const favoriteKey = (path: string) => DRAGGED + path;

/** The favorite's path a drag key carries, or null for an item in a folder. */
export const favoriteOfKey = (key: string): string | null => (key.startsWith(DRAGGED) ? key.slice(DRAGGED.length) : null);

/**
 * The places at the top: the drives with Full Disk Access or when the user
 * chose no folder, else the chosen folder and those added since.
 */
export function rootPlaces(drives: Drive[], root: string | null, folders: string[], fullDisk: boolean): Place[] {
  if (fullDisk || !root) return drives.map((d) => ({ name: d.name, path: d.path, file: false }));
  return [root, ...folders].map((path) => ({ name: baseName(path), path, file: false }));
}

export const favoritePlaces = (favorites: Favorite[]): Place[] =>
  favorites.map((f) => ({ name: baseName(f.path), path: f.path, file: f.file }));

/**
 * `favorites` with `items` pinned before favorite `index` (or at the end), in
 * their order. Ones already pinned move there instead of showing twice.
 */
export function pinFavorites(favorites: Favorite[], items: Favorite[], index: number): Favorite[] {
  const byPath = new Map([...favorites, ...items].map((f) => [f.path, f]));
  const moving = [...new Set(items.map((f) => f.path))];
  const order = moveTo(
    [...favorites.map((f) => f.path), ...moving.filter((p) => !favorites.some((f) => f.path === p))],
    moving,
    Math.min(index, favorites.length),
  );
  return order.map((path) => byPath.get(path)!);
}

export const unpinFavorite = (favorites: Favorite[], path: string): Favorite[] =>
  favorites.filter((f) => f.path !== path);

/**
 * `favorites` pointing where they are after folders moved or were renamed:
 * ones that were the folder or inside it follow it.
 */
export const relocateFavorites = (favorites: Favorite[], moves: Move[]): Favorite[] =>
  favorites.map((f) => ({ ...f, path: relocateAll(f.path, moves) }));

/** A favorite unpinned because it went to the Trash, with where it was pinned. */
export interface Unpinned {
  index: number;
  favorite: Favorite;
}

/** `favorites` without those that are, or are inside, the `removed` folders, and what was unpinned. */
export function unpinRemoved(favorites: Favorite[], removed: string[]): { kept: Favorite[]; unpinned: Unpinned[] } {
  const gone = (f: Favorite) => removed.some((r) => isWithin(f.path, r));
  return {
    kept: favorites.filter((f) => !gone(f)),
    unpinned: favorites.flatMap((favorite, index) => (gone(favorite) ? [{ index, favorite }] : [])),
  };
}

/** `favorites` with `unpinned` pinned again where they were; ones pinned since stay where they are. */
export function repin(favorites: Favorite[], unpinned: Unpinned[]): Favorite[] {
  const next = [...favorites];
  for (const { index, favorite } of [...unpinned].sort((a, b) => a.index - b.index)) {
    if (!next.some((f) => f.path === favorite.path)) next.splice(Math.min(index, next.length), 0, favorite);
  }
  return next;
}

/** Favorites read back from storage; anything unreadable is left out. */
export function parseFavorites(raw: string | null): Favorite[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is Favorite => typeof f?.path === "string" && isAbsolutePath(f.path) && typeof f.file === "boolean",
    );
  } catch {
    return [];
  }
}

/**
 * What dragged `keys` pin: folders as they are, files keyed by their path
 * (`isFile` tells them from folders) as files, downloads as their finished
 * file (`fileOf` gives it, or null for one without a file yet, which is left
 * out), and favorites dragged within the sidebar as they were pinned.
 */
export function toFavorites(
  keys: string[],
  favorites: Favorite[],
  fileOf: (id: string) => string | null,
  isFile: (path: string) => boolean = () => false,
): Favorite[] {
  return keys.flatMap((key): Favorite[] => {
    const pinned = favoriteOfKey(key);
    if (pinned !== null) return favorites.filter((f) => f.path === pinned);
    if (isFolderKey(key)) return [{ path: key, file: isFile(key) }];
    const file = fileOf(key);
    return file ? [{ path: file, file: true }] : [];
  });
}

/** The sidebar's sections, in their first order. */
export const SECTIONS = ["places", "favorites", "views", "downloads"] as const;
export type SectionId = (typeof SECTIONS)[number];

const isSection = (value: unknown): value is SectionId => SECTIONS.includes(value as SectionId);

/** Section ids read back from storage: known ones, each once; anything else is left out. */
export function parseSections(raw: string | null): SectionId[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isSection))] : [];
  } catch {
    return [];
  }
}

/**
 * Every section in the stored order. Any it lacks, such as one added since,
 * go after the section they follow at first, or first if none is there.
 */
export function sectionOrder(stored: SectionId[]): SectionId[] {
  const order = [...stored];
  SECTIONS.forEach((id, i) => {
    if (order.includes(id)) return;
    const before = SECTIONS.slice(0, i)
      .reverse()
      .find((s) => order.includes(s));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  return order;
}

/**
 * Where a section dragged to `y` goes among the sections showing, given each
 * one's vertical middle: before the first whose middle is below `y`, else last.
 */
export function sectionDropIndex(middles: number[], y: number): number {
  const index = middles.findIndex((middle) => y < middle);
  return index < 0 ? middles.length : index;
}

/**
 * `order` with section `id` moved to before the section showing at `index` of
 * `shown` (or after the last one showing). Hidden sections keep their places.
 */
export function moveSection(order: SectionId[], shown: SectionId[], id: SectionId, index: number): SectionId[] {
  const target = shown[index];
  const last = shown[shown.length - 1];
  return moveTo(order, [id], target === undefined ? order.indexOf(last) + 1 : order.indexOf(target)) as SectionId[];
}

/** What each section's header says; the places are Locations when they're drives. */
export const sectionLabel = (id: SectionId, drives: boolean): string =>
  ({ places: drives ? "Locations" : "Folders", favorites: "Favorites", views: "Views", downloads: "Downloading" })[id];

/** `hidden` with section `id` hidden from the sidebar, or shown again. */
export const withSectionShown = (hidden: SectionId[], id: SectionId, shown: boolean): SectionId[] =>
  shown ? hidden.filter((s) => s !== id) : hidden.includes(id) ? hidden : [...hidden, id];

/**
 * The sections the sidebar shows, in `order`: those not hidden, and
 * Downloading only while something is downloading.
 */
export const visibleSections = (order: SectionId[], hidden: SectionId[], downloading: boolean): SectionId[] =>
  order.filter((id) => !hidden.includes(id) && (id !== "downloads" || downloading));

/** `collapsed` with section `id` collapsed, or expanded if it was. */
export const toggleSection = (collapsed: SectionId[], id: SectionId): SectionId[] =>
  collapsed.includes(id) ? collapsed.filter((s) => s !== id) : [...collapsed, id];

/** The sidebar's width at first, and how narrow and wide it may be dragged, in pixels. */
export const SIDEBAR_WIDTH = 200;
export const SIDEBAR_MIN_WIDTH = 150;
export const SIDEBAR_MAX_WIDTH = 400;

/** A width dragged to, kept within the sidebar's limits and to whole pixels. */
export const clampSidebarWidth = (width: number): number =>
  Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));

/** The stored sidebar width, or the default when there's none or it isn't a number. */
export function parseSidebarWidth(raw: string | null): number {
  const width = Number(raw ?? NaN);
  return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_WIDTH;
}
