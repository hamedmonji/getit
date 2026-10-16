import type { ReactNode } from "react";
import type { DownloadItem } from "../lib/engine";
import { formatEta, formatSize, formatSpeed } from "../lib/format";
import type { FileVm } from "../lib/viewModels";
import { ActionButton, ProgressBar } from "./Glyphs";

const STATUS: Record<DownloadItem["status"], string> = {
  queued: "Waiting in queue",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Finished",
  failed: "Failed",
};

/**
 * The panel above the status bar with everything known about the selected
 * download. `item` is null when nothing (or more than one thing) is selected.
 */
export function Details({
  item,
  vm,
  speed,
  folder,
  selectionLabel,
  onAction,
  onCopy,
  onReveal,
}: {
  item: DownloadItem | null;
  vm: FileVm | null;
  /** Current speed in bytes per second. */
  speed: number;
  /** The download's folder, as shown to the user. */
  folder: string;
  /** Shown instead when no single download is selected. */
  selectionLabel: string;
  onAction: (vm: FileVm) => void;
  onCopy: (text: string) => void;
  onReveal: () => void;
}) {
  if (!item || !vm) {
    return (
      <section className="details" aria-label="Details">
        <div className="details-empty">{selectionLabel}</div>
      </section>
    );
  }

  const total = item.total_bytes;
  const running = item.status === "downloading";
  const pct = total ? Math.min(100, (item.downloaded / total) * 100) : 0;
  const progress = total
    ? `${formatSize(item.downloaded)} of ${formatSize(total)} (${Math.floor(pct)}%)`
    : formatSize(item.downloaded);
  const resumable = item.resumable === null ? "Not known yet" : item.resumable ? "Yes" : "No — pausing starts over";

  return (
    <section className="details" aria-label="Details">
      <div className="details-head">
        <span className="details-name ellipsis" title={vm.name}>
          {vm.name}
        </span>
        <span className={item.status === "failed" ? "details-status status-warning" : "details-status"}>
          {vm.missing ? "Finished · file missing" : STATUS[item.status]}
        </span>
        <div className="spacer" />
        <ActionButton className="details-action" vm={vm} onAction={onAction} />
      </div>
      {!vm.done && <ProgressBar className="details-bar" pct={pct} color={vm.color} />}
      <dl className="details-grid">
        <Row label="Size">{total || vm.done ? progress : `${progress} · size not reported`}</Row>
        {running && <Row label="Speed">{formatSpeed(speed)}</Row>}
        {running && total ? <Row label="Time left">{formatEta(speed ? (total - item.downloaded) / speed : Infinity)}</Row> : null}
        <Row label="Link" mono copy={item.url} onCopy={onCopy}>
          {item.url}
        </Row>
        <Row label="Folder">
          <button className="details-link ellipsis" title="Show in folder" onClick={onReveal}>
            {folder}
          </button>
        </Row>
        <Row label="Resumable">{resumable}</Row>
        <Row label="Added">{new Date(item.added_at).toLocaleString()}</Row>
        {item.last_modified && <Row label="Modified on server">{item.last_modified}</Row>}
        {item.etag && (
          <Row label="ETag" mono>
            {item.etag}
          </Row>
        )}
        {item.error && (
          <Row label="Error" danger>
            {item.error}
          </Row>
        )}
      </dl>
    </section>
  );
}

function Row({
  label,
  mono,
  danger,
  copy,
  onCopy,
  children,
}: {
  label: string;
  mono?: boolean;
  danger?: boolean;
  copy?: string;
  onCopy?: (text: string) => void;
  children: ReactNode;
}) {
  const cls = ["details-value", mono && "mono", danger && "status-warning"].filter(Boolean).join(" ");
  return (
    <>
      <dt>{label}</dt>
      <dd className={cls}>
        <span className="details-text">{children}</span>
        {copy !== undefined && onCopy && (
          <button className="plain-btn details-copy" onClick={() => onCopy(copy)}>
            Copy
          </button>
        )}
      </dd>
    </>
  );
}
