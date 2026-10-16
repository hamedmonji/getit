import { formatSpeed } from "../lib/format";
import type { FileVm, OverviewNode } from "../lib/viewModels";
import { ActionButton, ProgressBar } from "./Glyphs";
import { CloseIcon, FolderIcon, PauseIcon } from "./icons";

interface Handlers {
  onOpenQueue: (dir: string) => void;
  onOpenFile: (dir: string, id: string) => void;
  onAction: (vm: FileVm) => void;
  /** Stops everything in a queue, by queue id. */
  onPauseQueue: (id: string) => void;
}

/**
 * The side panel listing every running download, in a card for its queue, with
 * the cards of queues in folders below nested inside. Clicking a queue's name
 * goes to its folder; clicking a download goes there with it selected.
 */
export function Overview({
  nodes,
  onPauseAll,
  onClose,
  ...handlers
}: Handlers & {
  nodes: OverviewNode[];
  /** Stops everything in every queue. */
  onPauseAll: () => void;
  onClose: () => void;
}) {
  const all = flatten(nodes);
  const running = all.reduce((n, node) => n + node.files.length, 0);
  const speed = all.reduce((sum, node) => sum + node.speed, 0);
  return (
    <aside className="overview" aria-label="Overview">
      <div className="overview-head">
        <span className="overview-title">Downloading</span>
        <span className="overview-total" title={`${running} running`}>
          {running > 0 && formatSpeed(speed)}
        </span>
        {running > 0 && (
          <button className="plain-btn overview-stop" title="Pause every queue and download" onClick={onPauseAll}>
            <PauseIcon size={9} />
            Stop all
          </button>
        )}
        <button className="icon-btn" title="Close overview" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="overview-body">
        {nodes.length ? (
          nodes.map((node) => <QueueCard key={node.dir} node={node} {...handlers} />)
        ) : (
          <div className="overview-empty">Nothing is downloading.</div>
        )}
      </div>
    </aside>
  );
}

function QueueCard({ node, ...handlers }: Handlers & { node: OverviewNode }) {
  const { onOpenQueue, onOpenFile, onAction, onPauseQueue } = handlers;
  const meta = [
    formatSpeed(node.speed),
    node.waiting > 0 && `${node.waiting} waiting`,
    node.paused && "queue paused",
  ].filter(Boolean);
  return (
    <section className="ov-queue">
      <div className="ov-queue-head">
        <button className="ov-queue-open" title={`Go to ${node.dir}`} onClick={() => onOpenQueue(node.dir)}>
          <FolderIcon size={13} />
          <span className="ov-queue-text">
            <span className="ov-queue-name ellipsis">{node.label}</span>
            <span className="ov-queue-meta ellipsis">{meta.join(" · ")}</span>
          </span>
        </button>
        <button className="ov-queue-pause" title="Pause everything in this queue" onClick={() => onPauseQueue(node.id)}>
          <PauseIcon size={9} />
        </button>
      </div>
      <ul className="ov-files">
        {node.files.map((f) => (
          <li key={f.id} className="ov-file" title={f.info} onClick={() => onOpenFile(node.dir, f.id)}>
            <div className="ov-file-line">
              <span className="ov-file-name ellipsis">{f.name}</span>
              <ActionButton className="ov-file-action" vm={f} onAction={onAction} />
            </div>
            <ProgressBar className="row-bar" pct={f.pct} color={f.color} />
            <div className="ov-file-status ellipsis">{f.status}</div>
          </li>
        ))}
      </ul>
      {node.children.map((child) => (
        <QueueCard key={child.dir} node={child} {...handlers} />
      ))}
    </section>
  );
}

function flatten(nodes: OverviewNode[]): OverviewNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}
