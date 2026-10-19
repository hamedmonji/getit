import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isMediaKind } from "../lib/fileKind";
import type { FileVm, FolderVm } from "../lib/viewModels";
import { FileIcon } from "./FileIcon";
import { PauseIcon, PlayIcon, RetryIcon } from "./icons";

type Size = "large" | "small";

/** File-type icon. Images and videos fill in as they download; other kinds
 * are dimmed until done. The label is dropped in the list, too small to read. */
export function FileGlyph({ vm, size }: { vm: FileVm; size: Size }) {
  const media = isMediaKind(vm.kind);
  const opacity = vm.missing ? 0.4 : vm.done || media ? 1 : 0.6;
  return (
    <div className={`file-glyph ${size}`} style={{ opacity }}>
      <FileIcon
        kind={vm.kind}
        ext={vm.ext}
        reveal={vm.done ? 100 : vm.pct}
        edge={vm.active}
        hue={vm.hue}
        hideLabel={size === "small"}
      />
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
  variant = "ghost",
  size = "icon-xs",
  className,
}: {
  vm: FileVm;
  onAction: (vm: FileVm) => void;
  variant?: "ghost" | "secondary";
  size?: "icon-xs" | "icon-sm";
  className?: string;
}) {
  if (!vm.action) return null;
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    onAction(vm);
  };
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(variant === "ghost" ? "text-ink-muted" : "text-ink", className)}
      title={vm.actionLabel}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {vm.action === "pause" && <PauseIcon />}
      {vm.action === "resume" && <PlayIcon />}
      {vm.action === "retry" && <RetryIcon />}
    </Button>
  );
}

export function ProgressBar({ pct, color, className }: { pct: number; color: string; className: string }) {
  return (
    <div className={className}>
      <div style={{ width: pct + "%", background: color }} />
    </div>
  );
}
