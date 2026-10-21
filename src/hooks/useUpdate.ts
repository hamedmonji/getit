import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

export type UpdatePhase =
  | { kind: "available" }
  /** `pct` is null while the download's size is unknown. */
  | { kind: "downloading"; pct: number | null }
  | { kind: "ready" }
  | { kind: "failed"; error: string };

/**
 * A newer version from the release feed, checked once at launch in release
 * builds. `install` downloads and installs it; `restart` relaunches into it.
 */
export function useUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "available" });

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    check()
      .then(setUpdate)
      .catch((e) => console.error("Couldn't check for updates:", e));
  }, []);

  const install = async () => {
    if (!update) return;
    let total: number | null = null;
    let got = 0;
    setPhase({ kind: "downloading", pct: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") {
          got += event.data.chunkLength;
          setPhase({ kind: "downloading", pct: total ? Math.round((got / total) * 100) : null });
        }
      });
      setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: "failed", error: String(e) });
    }
  };

  return { update, phase, install, restart: () => invoke<void>("relaunch"), dismiss: () => setUpdate(null) };
}
