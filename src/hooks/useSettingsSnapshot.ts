import { useEffect, useMemo, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  createRequests,
  MAIN_WINDOW,
  SETTINGS_ACTION,
  SETTINGS_READY,
  SETTINGS_REPLY,
  SETTINGS_SNAPSHOT,
  type SettingsAction,
  type SettingsReply,
  type SettingsSnapshot,
} from "../lib/settingsWindow";

/**
 * The settings window's side: the main window's settings, kept current, null
 * until they first come; `send` passes a change back, and `apply` asks the main
 * window to give every queue the defaults, resolving with how many it changed.
 */
export function useSettingsSnapshot() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const requests = useMemo(createRequests, []);

  useEffect(() => {
    const unlisteners = [
      listen<SettingsSnapshot>(SETTINGS_SNAPSHOT, (e) => setSnapshot(e.payload)),
      listen<SettingsReply>(SETTINGS_REPLY, (e) => requests.settle(e.payload)),
    ];
    // Once listening, so the settings that answer this aren't missed.
    Promise.all(unlisteners)
      .then(() => emitTo(MAIN_WINDOW, SETTINGS_READY))
      .catch((e) => console.error("Couldn't reach the main window:", e));
    return () => unlisteners.forEach((p) => p.then((f) => f()));
  }, [requests]);

  return useMemo(() => {
    const send = (action: SettingsAction) => {
      emitTo(MAIN_WINDOW, SETTINGS_ACTION, action).catch((e) => console.error("Couldn't send a setting:", e));
    };
    const apply = () => {
      const { request, answer } = requests.next();
      send({ type: "applyQueueDefaults", request });
      return answer;
    };
    return { snapshot, send, apply };
  }, [snapshot, requests]);
}
