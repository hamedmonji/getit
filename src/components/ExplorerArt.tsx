// A File Explorer look-alike for onboarding on Windows, in place of the Finder
// one: simple shapes in Windows 11's colours, no Microsoft artwork.

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A row in the Explorer window's navigation pane. */
export type ExplorerPlace = { kind: "folder" | "drive"; label: string; selected: boolean } | { kind: "separator" };

/** Step 1's navigation pane: the user's folders, with Downloads open, then the system drive. */
export const STEP1_PLACES: ExplorerPlace[] = [
  ...["Desktop", "Downloads", "Documents", "Pictures", "Videos"].map(
    (label): ExplorerPlace => ({ kind: "folder", label, selected: label === "Downloads" }),
  ),
  { kind: "separator" },
  { kind: "drive", label: "Local Disk (C:)", selected: false },
];

/** Windows' yellow folder, as a tab of darker yellow behind a lighter front. */
export function ExplorerFolder({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex-none", className)} aria-hidden>
      <span className="absolute top-0 left-0 h-[30%] w-[45%] rounded-t-[1.5px] bg-(--explorer-folder-back)" />
      <span className="absolute inset-x-0 top-[14%] bottom-0 rounded-[1px_2px_2px_2px] bg-(--explorer-folder-back)" />
      <span className="absolute inset-x-0 top-[30%] bottom-0 rounded-[2px] bg-(--explorer-folder)" />
    </span>
  );
}

function ExplorerDrive() {
  return (
    <span className="relative h-[11px] w-4 flex-none rounded-[2px] border-[1.5px] border-(--explorer-sub)" aria-hidden>
      <span className="absolute top-[3px] right-[2px] h-[2px] w-[3px] bg-[#3aa655]" />
    </span>
  );
}

/** The minimize, maximize and close glyphs at a window's top right, drawn, `width` apart. */
export function CaptionGlyphs({ width, height }: { width: number; height: number }) {
  const cell = "grid place-items-center";
  const style = { width, height };
  const stroke = { stroke: "currentColor", strokeWidth: 1 };
  return (
    <div className="ml-auto flex flex-none" aria-hidden>
      <span className={cell} style={style}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5.5h10" {...stroke} />
        </svg>
      </span>
      <span className={cell} style={style}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x=".5" y=".5" width="9" height="9" rx="1.5" fill="none" {...stroke} />
        </svg>
      </span>
      <span className={cell} style={style}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M.5.5l9 9M9.5.5l-9 9" {...stroke} />
        </svg>
      </span>
    </div>
  );
}

/**
 * A File Explorer window open at `title`: its tab and caption buttons, the
 * address bar and search, the navigation pane, and a list with a Name column
 * and one more, holding `children`.
 */
export function ExplorerWindow({
  title,
  height,
  places,
  column,
  columnWidth,
  children,
}: {
  title: string;
  height: number;
  places: ExplorerPlace[];
  /** The list's second column. */
  column: string;
  columnWidth: number;
  children: ReactNode;
}) {
  const columns: CSSProperties = { gridTemplateColumns: `minmax(0,1fr) ${columnWidth}px` };
  return (
    <div
      aria-hidden
      className="explorer-art flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--explorer-border) bg-(--explorer-bg) text-(--explorer-ink) shadow-[0_10px_28px_rgba(0,0,0,.14)]"
      style={{ height }}
    >
      <div className="flex h-7 flex-none items-center bg-(--explorer-tabs) pl-2.5">
        <span className="mt-1.5 flex h-[22px] items-center gap-1.5 rounded-t-md bg-(--explorer-bg) px-2.5 text-[11px]">
          <ExplorerFolder className="h-2.5 w-3" />
          {title}
        </span>
        <CaptionGlyphs width={30} height={28} />
      </div>
      <div className="flex h-[34px] flex-none items-center gap-2 border-b border-(--explorer-line) px-2.5">
        <svg width="12" height="12" viewBox="0 0 16 16">
          <path d="M13 8H3m4-4L3 8l4 4" fill="none" stroke="var(--explorer-sub)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg width="12" height="12" viewBox="0 0 16 16">
          <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="var(--explorer-faint)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex h-[22px] min-w-0 flex-1 items-center gap-1.5 rounded bg-(--explorer-field) px-2 text-[11px] whitespace-nowrap">
          <ExplorerFolder className="h-2.5 w-3" />
          <span className="text-(--explorer-sub)">›</span>
          {title}
          <span className="text-(--explorer-sub)">›</span>
        </div>
        <div className="flex h-[22px] w-[76px] flex-none items-center gap-[5px] rounded bg-(--explorer-field) px-[7px] text-[10.5px] text-(--explorer-faint)">
          <svg width="10" height="10" viewBox="0 0 16 16">
            <circle cx="9.5" cy="6.5" r="4.5" fill="none" stroke="var(--explorer-sub)" strokeWidth="1.5" />
            <path d="M6 10l-4.5 4.5" stroke="var(--explorer-sub)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Search
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[124px] flex-none flex-col gap-px border-r border-(--explorer-line) px-1.5 py-2 text-[11.5px]">
          {places.map((place, i) =>
            place.kind === "separator" ? (
              <div key={i} className="mx-1.5 my-[5px] h-px bg-(--explorer-line)" />
            ) : (
              <div
                key={i}
                className={cn(
                  "relative flex h-[22px] items-center gap-[7px] rounded px-1.5",
                  place.selected && "bg-(--explorer-selected)",
                )}
              >
                {place.selected && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-sm bg-(--ob-accent)" />}
                {place.kind === "drive" ? <ExplorerDrive /> : <ExplorerFolder className="h-[11px] w-3.5" />}
                <span className="min-w-0 flex-1 truncate">{place.label}</span>
              </div>
            ),
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="grid h-6 flex-none items-center border-b border-(--explorer-line) px-4 text-[11px] text-(--explorer-sub)" style={columns}>
            <span className="pl-[18px]">Name</span>
            <span className="text-right">{column}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** A file or folder's name in the Explorer list, indented by `depth`, a folder with its expand chevron. */
export function ExplorerRowName({
  depth,
  folder,
  open,
  name,
}: {
  depth: number;
  folder: boolean;
  open: boolean;
  name: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
      <span className="grid w-2.5 flex-none place-items-center text-(--explorer-faint)">
        {folder && (
          <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M2.5 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {folder ? (
        <ExplorerFolder className="h-[13px] w-4" />
      ) : (
        <span className="mx-0.5 h-[15px] w-3 flex-none rounded-[1px_4px_1px_1px] border border-(--explorer-faint) bg-(--explorer-bg)" />
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}
