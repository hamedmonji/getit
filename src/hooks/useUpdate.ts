import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { justUpdated, testDownloadEvents, testVersion, type UpdatePhase } from "../lib/update";

/** The version getit restarted to update to, kept across the relaunch. */
const UPDATING_TO = "getit.updatingTo";
/** How long "Updated to …" shows after restarting into the new version. */
const UPDATED_MS = 5000;

/** What updating needs of a newer version: the updater's, or a test one. */
interface Pending {
  version: string;
  downloadAndInstall: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
  /** A test update, which pretends to restart instead of relaunching. */
  test?: boolean;
}

/** A pretend download, about 3 seconds long, that fails halfway when `fails`. */
function testUpdate(version: string, fails: boolean): Pending {
  return {
    version,
    test: true,
    downloadAndInstall: async (onEvent) => {
      const events = testDownloadEvents(48_000_000, 24);
      for (const [i, event] of events.entries()) {
        if (fails && i === events.length / 2) throw new Error("The test update failed, as asked");
        onEvent(event);
        await new Promise((done) => setTimeout(done, 120));
      }
    },
  };
}

function takeUpdatingTo(): string | null {
  try {
    const version = localStorage.getItem(UPDATING_TO);
    localStorage.removeItem(UPDATING_TO);
    return version;
  } catch {
    return null;
  }
}

/**
 * A newer version from the release feed, checked once at launch in release
 * builds (or a test one, from `test`), and where updating to it is. `download` downloads and installs it;
 * `restart` relaunches into it, and `wait` restarts once the running downloads
 * finish (the app calls `restart` then). Just after restarting into a new
 * version, it says so for a moment.
 */
export function useUpdate() {
  const [update, setUpdate] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "available" });
  /** The version just updated to, while that shows. */
  const [updated, setUpdated] = useState<string | null>(null);
  /** Put off with Later, until the next launch. */
  const [later, setLater] = useState(false);

  useEffect(() => {
    const updatingTo = takeUpdatingTo();
    if (updatingTo) {
      getVersion().then((current) => {
        if (justUpdated(updatingTo, current)) setUpdated(current);
      }, console.error);
    }
    if (!import.meta.env.PROD) return;
    check()
      .then(setUpdate)
      .catch((e) => console.error("Couldn't check for updates:", e));
  }, []);

  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setUpdated(null), UPDATED_MS);
    return () => clearTimeout(timer);
  }, [updated]);

  const download = async () => {
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

  const restart = () => {
    if (!update) return;
    setPhase({ kind: "restarting" });
    if (update.test) {
      // Pretends to relaunch: gone for a moment, then back updated.
      setTimeout(() => {
        setUpdate(null);
        setPhase({ kind: "available" });
        setUpdated(update.version);
      }, 1000);
      return;
    }
    try {
      localStorage.setItem(UPDATING_TO, update.version);
    } catch {
      // Not said once restarted; harmless.
    }
    invoke<void>("relaunch").catch((e) => setPhase({ kind: "failed", error: String(e) }));
  };

  // Later puts off what waits on the user; a download, wait or restart under way still shows.
  const putOff = later && ["available", "ready", "failed"].includes(phase.kind);
  const shown = updated
    ? { phase: { kind: "updated" } as UpdatePhase, version: updated }
    : update && !putOff
      ? { phase, version: update.version }
      : null;

  /** Shows a pretend update to the next version, which fails its download when `fails`. */
  const test = async (fails: boolean) => {
    const version = testVersion(await getVersion().catch(() => "0.0.0"));
    setLater(false);
    setUpdated(null);
    setPhase({ kind: "available" });
    setUpdate(testUpdate(version, fails));
  };

  return {
    /** What to show, or null for nothing. */
    shown,
    test: (fails: boolean) => void test(fails),
    download: () => void download(),
    restart,
    wait: () => setPhase({ kind: "waiting" }),
    later: () => setLater(true),
  };
}
