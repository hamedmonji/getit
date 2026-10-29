import { useEffect, useRef } from "react";
import { dockOverlayLayout, dockStatus, sameDockStatus, type DockStatus } from "../lib/dock";
import { showDockOverlay } from "../lib/dockIcon";
import type { EngineState } from "./useEngine";

/** How often the Dock icon catches up with the downloads, rather than on every progress tick. */
const DOCK_UPDATE_MS = 1000;

function showOnDock(status: DockStatus | null) {
  showDockOverlay(dockOverlayLayout(status)).catch(() => {});
}

/**
 * Shows the running downloads' combined speed and progress at the bottom of
 * the Dock icon, cleared when none run.
 */
export function useDockProgress({ downloads, speeds }: EngineState) {
  const latest = useRef({ downloads, speeds });
  latest.current = { downloads, speeds };

  useEffect(() => {
    let shown: DockStatus | null = null;
    const update = () => {
      const next = dockStatus(latest.current.downloads, latest.current.speeds);
      if (sameDockStatus(shown, next)) return;
      shown = next;
      showOnDock(next);
    };
    const timer = setInterval(update, DOCK_UPDATE_MS);
    return () => {
      clearInterval(timer);
      if (shown !== null) showOnDock(null);
    };
  }, []);
}
