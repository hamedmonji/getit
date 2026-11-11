import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings } from "./components/Settings";
import { useDocumentAppearance } from "./hooks/useDocumentAppearance";
import { useSettingsSnapshot } from "./hooks/useSettingsSnapshot";
import { IS_MAC, IS_WINDOWS } from "./lib/platform";
import { closesSettingsWindow, settingsProps, type SettingsSnapshot } from "./lib/settingsWindow";

const PLATFORM = { mac: IS_MAC, windows: IS_WINDOWS };

/** The settings window: the settings page, showing the main window's settings. */
export function SettingsWindow() {
  const { snapshot, send, apply } = useSettingsSnapshot();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !closesSettingsWindow(e, IS_MAC)) return;
      e.preventDefault();
      getCurrentWindow().close().catch(console.error);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Shown once there's something in it, then brought forward.
  useEffect(() => {
    if (!snapshot || shown) return;
    setShown(true);
    const current = getCurrentWindow();
    current
      .show()
      .then(() => current.setFocus())
      .catch(console.error);
  }, [snapshot, shown]);

  if (!snapshot) return null;
  return <SettingsPage snapshot={snapshot} send={send} apply={apply} />;
}

function SettingsPage({
  snapshot,
  send,
  apply,
}: {
  snapshot: SettingsSnapshot;
  send: ReturnType<typeof useSettingsSnapshot>["send"];
  apply: () => Promise<number>;
}) {
  const { resolvedTheme, accent, background, density, stripes } = snapshot.appearance;
  useDocumentAppearance(resolvedTheme, accent, background, density, stripes);
  const props = useMemo(() => settingsProps(snapshot, PLATFORM, send, apply), [snapshot, send, apply]);
  return <Settings {...props} />;
}
