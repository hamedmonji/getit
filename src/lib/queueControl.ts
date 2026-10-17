// Pausing and resuming whole queues.

import type { EngineState } from "../hooks/useEngine";
import { engine, type QueueInfo } from "./engine";
import { stats } from "./viewModels";

/** A queue's downloads paused one by one. */
export function heldIn(state: EngineState, target: QueueInfo) {
  return target.downloads.filter((id) => state.downloads[id]?.status === "paused");
}

// Menus show a queue's own state: paused, or stopped by pausing its
// downloads one by one; downloads started on their own don't count.
export function isQueuePaused(state: EngineState, target: QueueInfo) {
  const st = stats(state, target.dir, false);
  return target.settings.paused || (st.active === 0 && st.queued === 0 && heldIn(state, target).length > 0);
}

// Pausing or resuming means nothing for a queue with nothing left to download.
export function hasWork(state: EngineState, target: QueueInfo) {
  return stats(state, target.dir, false).pending > 0;
}

// Unpauses a queue and puts downloads paused one by one back in line.
export async function resumeQueue(state: EngineState, target: QueueInfo) {
  const { settings } = target;
  const held = heldIn(state, target);
  if (settings.paused) await engine.setQueueSettings(target.id, { ...settings, paused: false });
  if (held.length) await engine.requeue(held);
}

// Stops everything in a queue. Pausing a running queue stops all its
// downloads; in one that's paused already, only downloads started on their
// own run, so they're paused one by one.
export function pauseQueue(state: EngineState, target: QueueInfo): Promise<unknown> {
  const { settings } = target;
  if (!settings.paused) return engine.setQueueSettings(target.id, { ...settings, paused: true });
  const running = target.downloads.filter((id) => state.downloads[id]?.status === "downloading");
  return Promise.all(running.map((id) => engine.pause(id)));
}

/** Stops every queue that has something running. */
export function pauseAll(state: EngineState) {
  return Promise.all(
    Object.values(state.queues)
      .filter((q) => q.downloads.some((id) => state.downloads[id]?.status === "downloading"))
      .map((q) => pauseQueue(state, q)),
  );
}
