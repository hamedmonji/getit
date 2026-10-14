import type { MouseEvent } from "react";
import type { FileVm, FolderVm } from "../lib/viewModels";
import { PauseIcon, PlayIcon, RetryIcon } from "./icons";

type Size = "large" | "small";

function thumbGradient(hue: number): string {
  return `linear-gradient(160deg, oklch(0.78 0.08 ${hue}) 0%, oklch(0.56 0.11 ${(hue + 35) % 360}) 60%, oklch(0.36 0.07 ${(hue + 60) % 360}) 100%)`;
}

/** File icon: a thumbnail for media or an extension badge. Dimmed until the download finishes. */
export function FileGlyph({ vm, size }: { vm: FileVm; size: Size }) {
  const opacity = vm.missing ? 0.4 : vm.done ? 1 : 0.55;
  return (
    <div className={`file-glyph ${size}`}>
      {vm.isMedia ? (
        <div className="thumb" style={{ background: thumbGradient(vm.hue), opacity }} />
      ) : (
        <div
          className="badge"
          style={{
            background: `color-mix(in oklch, oklch(0.62 0.12 ${vm.hue}) ${vm.done ? 24 : 13}%, var(--panel2))`,
            opacity,
          }}
        >
          {size === "large" && (
            <span style={{ color: `color-mix(in oklch, oklch(0.6 0.14 ${vm.hue}) 70%, var(--ink))` }}>
              {vm.ext}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Folder icon in Finder's colours; grey while its queue is paused. */
export function FolderGlyph({ vm, size }: { vm: FolderVm; size: Size }) {
  return (
    <div className={`folder-glyph ${size}` + (vm.paused ? " paused" : "")}>
      {/* The back with its tab, mostly hidden behind the front. */}
      <div className="folder-back" />
      <div className="folder-body" />
      {size === "large" && vm.active > 0 && <span className="folder-count">{vm.active}</span>}
      {size === "large" && vm.paused && (
        <span className="folder-paused">
          <PauseIcon size={8} weight={3} />
        </span>
      )}
    </div>
  );
}

export function ActionButton({
  vm,
  onAction,
  className,
}: {
  vm: FileVm;
  onAction: (vm: FileVm) => void;
  className: string;
}) {
  if (!vm.action) return null;
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    onAction(vm);
  };
  return (
    <button className={className} title={vm.actionLabel} onClick={onClick} onDoubleClick={(e) => e.stopPropagation()}>
      {vm.action === "pause" && <PauseIcon />}
      {vm.action === "resume" && <PlayIcon />}
      {vm.action === "retry" && <RetryIcon />}
    </button>
  );
}

export function ProgressBar({ pct, color, className }: { pct: number; color: string; className: string }) {
  return (
    <div className={className}>
      <div style={{ width: pct + "%", background: color }} />
    </div>
  );
}
