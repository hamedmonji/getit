import { useEffect, useReducer } from "react";
import {
  engine,
  onEngineEvent,
  onResync,
  type DownloadId,
  type DownloadItem,
  type EngineEvent,
  type QueueId,
  type QueueInfo,
  type Snapshot,
} from "../lib/engine";

export interface EngineState {
  queues: Record<QueueId, QueueInfo>;
  downloads: Record<DownloadId, DownloadItem>;
  /** Latest speed of each running download, in bytes per second. */
  speeds: Record<DownloadId, number>;
  saveError: string | null;
  /** False until the first snapshot has loaded. */
  loaded: boolean;
}

type Action = { kind: "snapshot"; snapshot: Snapshot } | { kind: "event"; event: EngineEvent };

const initial: EngineState = { queues: {}, downloads: {}, speeds: {}, saveError: null, loaded: false };

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _, ...rest } = record;
  return rest;
}

function reduce(state: EngineState, action: Action): EngineState {
  if (action.kind === "snapshot") {
    const { queues, downloads } = action.snapshot;
    return {
      ...initial,
      loaded: true,
      queues: Object.fromEntries(queues.map((q) => [q.id, q])),
      downloads: Object.fromEntries(downloads.map((d) => [d.id, d])),
    };
  }
  const { event } = action;
  switch (event.type) {
    case "queue_changed":
      return { ...state, queues: { ...state.queues, [event.data.id]: event.data } };
    case "queue_removed":
      return { ...state, queues: without(state.queues, event.data.id) };
    case "download_added":
    case "download_changed": {
      const item = event.data;
      const speeds = item.status === "downloading" ? state.speeds : without(state.speeds, item.id);
      return { ...state, downloads: { ...state.downloads, [item.id]: item }, speeds };
    }
    case "download_removed":
      return {
        ...state,
        downloads: without(state.downloads, event.data.id),
        speeds: without(state.speeds, event.data.id),
      };
    case "progress": {
      const { id, downloaded, total, speed_bps } = event.data;
      const item = state.downloads[id];
      if (!item) return state;
      return {
        ...state,
        downloads: { ...state.downloads, [id]: { ...item, downloaded, total_bytes: total } },
        speeds: speed_bps > 0 ? { ...state.speeds, [id]: speed_bps } : state.speeds,
      };
    }
    case "save_failed":
      return { ...state, saveError: event.data.error };
  }
}

/** Live engine state: loads a snapshot, then follows engine events. */
export function useEngine(): EngineState {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      engine.snapshot().then((snapshot) => {
        if (!cancelled) dispatch({ kind: "snapshot", snapshot });
      });
    const unlisten = Promise.all([
      onEngineEvent((event) => dispatch({ kind: "event", event })),
      onResync(load),
    ]);
    // Subscribe first so no change between the snapshot and the listeners is lost.
    unlisten.then(load);
    return () => {
      cancelled = true;
      unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  return state;
}
