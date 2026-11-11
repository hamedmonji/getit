import { useCallback, useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  runSettingsAction,
  SETTINGS_ACTION,
  SETTINGS_READY,
  SETTINGS_SNAPSHOT,
  SETTINGS_WINDOW,
  SETTINGS_WINDOW_OPTIONS,
  type SettingsHandlers,
  type SettingsSnapshot,
} from "../lib/settingsWindow";

/** Opens the settings window, or brings it forward when it's already open. */
export async function openSettingsWindow(): Promise<void> {
  const open = await WebviewWindow.getByLabel(SETTINGS_WINDOW);
  if (open) {
    await open.unminimize();
    await open.show();
    await open.setFocus();
    return;
  }
  const created = new WebviewWindow(SETTINGS_WINDOW, SETTINGS_WINDOW_OPTIONS);
  created.once("tauri://error", (e) => console.error("Couldn't open the settings window:", e.payload));
}

/**
 * The main window's side of the settings window: sends it `snapshot` when it
 * opens and whenever the settings change, and runs `handlers` for what the
 * user changes there. `open` is whether the settings window is open.
 */
export function useSettingsWindow(snapshot: SettingsSnapshot, handlers: SettingsHandlers) {
  const [open, setOpen] = useState(false);
  // Counts the settings window's hellos, so each gets the settings even if nothing changed.
  const [hellos, setHellos] = useState(0);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    let closed = false;
    const opened = async (window: WebviewWindow | null) => {
      if (!window || closed) return;
      setOpen(true);
      setHellos((n) => n + 1);
      await window.once("tauri://destroyed", () => !closed && setOpen(false));
    };
    const unlisteners = [
      listen(SETTINGS_READY, () => WebviewWindow.getByLabel(SETTINGS_WINDOW).then(opened)),
      listen(SETTINGS_ACTION, (e) => {
        if (!runSettingsAction(e.payload, latest.current)) console.error("Unknown settings action:", e.payload);
      }),
    ];
    // A settings window left from before a reload of this one.
    WebviewWindow.getByLabel(SETTINGS_WINDOW).then(opened, console.error);
    return () => {
      closed = true;
      unlisteners.forEach((p) => p.then((f) => f()));
    };
  }, []);

  const json = JSON.stringify(snapshot);
  useEffect(() => {
    if (open) emitTo(SETTINGS_WINDOW, SETTINGS_SNAPSHOT, JSON.parse(json)).catch(console.error);
  }, [open, hellos, json]);

  const show = useCallback(() => {
    openSettingsWindow().catch((e) => console.error("Couldn't open the settings window:", e));
  }, []);

  return { open, show };
}
