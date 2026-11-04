// The update card along the bottom of the folder view, from the v9 Update
// design handoff: what it says and offers at each step of updating.

import { plural } from "./format";

export type UpdatePhase =
  | { kind: "available" }
  /** `pct` is null while the download's size is unknown. */
  | { kind: "downloading"; pct: number | null }
  | { kind: "ready" }
  /** Ready, restarting by itself once the running downloads finish. */
  | { kind: "waiting" }
  | { kind: "failed"; error: string }
  /** Relaunching into it, already installed. */
  | { kind: "restarting" }
  /** Just restarted into the new version. */
  | { kind: "updated" };

export type UpdateAction = "later" | "download" | "restart" | "wait";

export interface UpdateCard {
  /** Up arrow while updating, a clock while waiting, a tick once updated. */
  icon: "update" | "waiting" | "done";
  title: string;
  /** After the title, muted; empty for none. */
  detail: string;
  /** Whether it shows the download's progress. */
  progress: boolean;
  /** 0–100 while downloading; null when not, or while its size is unknown. */
  pct: number | null;
  /** Its buttons, the main one last. */
  actions: { action: UpdateAction; label: string; primary: boolean }[];
}

const later = { action: "later", label: "Later", primary: false } as const;

/**
 * What the card shows for `version` at `phase`, with `running` downloads in
 * progress. Once ready, restarting waits for running downloads unless the user
 * restarts now; null while restarting, as getit is about to close.
 */
export function updateCard(phase: UpdatePhase, version: string, running: number): UpdateCard | null {
  const base = { icon: "update" as const, detail: "", progress: false, pct: null, actions: [] };
  switch (phase.kind) {
    case "available":
      return {
        ...base,
        title: `Version ${version} is available`,
        actions: [later, { action: "download", label: "Download update", primary: true }],
      };
    case "downloading":
      return { ...base, title: `Downloading ${version}`, progress: true, pct: phase.pct };
    case "ready":
      return {
        ...base,
        title: `Version ${version} is ready`,
        detail: "Restart to finish updating",
        actions: [
          later,
          running
            ? { action: "wait", label: "Restart when done", primary: true }
            : { action: "restart", label: "Restart to update", primary: true },
        ],
      };
    case "waiting":
      return {
        ...base,
        icon: "waiting",
        title: "Updates when downloads finish",
        detail: `${plural(running, "download")} left`,
        actions: [{ action: "restart", label: "Restart now", primary: true }],
      };
    case "failed":
      return {
        ...base,
        title: `Couldn't download version ${version}`,
        detail: phase.error,
        actions: [later, { action: "download", label: "Try again", primary: true }],
      };
    case "restarting":
      return null;
    case "updated":
      return { ...base, icon: "done", title: `Updated to ${version}` };
  }
}

/** Whether getit, now at `current`, just restarted into the version it was updating to. */
export const justUpdated = (updatingTo: string | null, current: string): boolean => updatingTo === current;

/** The version a test update pretends to update `current` to: the next patch version. */
export function testVersion(current: string): string {
  const parts = current.split(".");
  const patch = Number(parts[2] ?? 0);
  return [parts[0] ?? "0", parts[1] ?? "0", Number.isFinite(patch) ? patch + 1 : 1].join(".");
}

/** The updater's download events, as a download of `total` bytes in `chunks` even chunks gives them. */
export type TestDownloadEvent =
  | { event: "Started"; data: { contentLength: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** What a test update's download reports: started, `chunks` chunks adding up to `total`, finished. */
export function testDownloadEvents(total: number, chunks: number): TestDownloadEvent[] {
  const size = Math.floor(total / chunks);
  const progress = Array.from({ length: chunks }, (_, i) => ({
    event: "Progress" as const,
    data: { chunkLength: i === chunks - 1 ? total - size * (chunks - 1) : size },
  }));
  return [{ event: "Started", data: { contentLength: total } }, ...progress, { event: "Finished" }];
}
