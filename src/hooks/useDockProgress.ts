import { useEffect, useRef } from "react";
import { dockOverlayLayout, dockStatus, sameDockStatus, type DockStatus } from "../lib/dock";
import { showDockOverlay } from "../lib/dockIcon";
import type { EngineState } from "./useEngine";

/** How often the Dock icon catches up with the downloads, rather than on every progress tick. */
const DOCK_UPDATE_MS = 1000;

/**
 * Shows the running downloads' combined speed and progress at the bottom of
 * the Dock icon, cleared when none run.
 */
export function useDockProgress({ downloads, speeds }: EngineState) {
  const latest = useRef({ downloads, speeds });
  latest.current = { downloads, speeds };

  useEffect(() => {
    // Unknown at first: the Dock keeps its overlay when the window reloads, so
    // the first update always goes through, clearing one left from before.
    let shown: DockStatus | null | undefined = undefined;
    // Drawing takes a moment, so updates wait their turn: a draw started just
    // before a clear can't land after it and leave the speed showing.
    let queue = Promise.resolve();
    const showOnDock = (status: DockStatus | null) => {
      queue = queue.then(() => showDockOverlay(dockOverlayLayout(status))).catch(() => {});
    };
    const update = () => {
      const next = dockStatus(latest.current.downloads, latest.current.speeds);
      if (shown !== undefined && sameDockStatus(shown, next)) return;
      shown = next;
      showOnDock(next);
    };
    const timer = setInterval(update, DOCK_UPDATE_MS);
    return () => {
      clearInterval(timer);
      if (shown) showOnDock(null);
    };
  }, []);
}
