// Builders for engine state in tests.

import type { EngineState } from "../hooks/useEngine";
import type { DownloadItem, QueueInfo } from "../lib/engine";

export function item(overrides: Partial<DownloadItem> & Pick<DownloadItem, "id" | "queue_id">): DownloadItem {
  return {
    url: `https://example.com/${overrides.id}.zip`,
    file_name: `${overrides.id}.zip`,
    total_bytes: 100,
    downloaded: 0,
    status: "queued",
    resumable: true,
    etag: null,
    last_modified: null,
    error: null,
    added_at: 0,
    ...overrides,
  };
}

export function queue(overrides: Partial<QueueInfo> & Pick<QueueInfo, "id" | "dir">): QueueInfo {
  return { settings: { max_concurrent: 2, paused: false, retries: 3, rename: [] }, downloads: [], ...overrides };
}

/** State holding `queues` and `items`; each queue lists the items whose `queue_id` is its id. */
export function stateOf(queues: QueueInfo[], items: DownloadItem[] = []): EngineState {
  return {
    queues: Object.fromEntries(
      queues.map((q) => [
        q.id,
        { ...q, downloads: q.downloads.length ? q.downloads : items.filter((d) => d.queue_id === q.id).map((d) => d.id) },
      ]),
    ),
    downloads: Object.fromEntries(items.map((d) => [d.id, d])),
    speeds: {},
    saveError: null,
    loaded: true,
  };
}
