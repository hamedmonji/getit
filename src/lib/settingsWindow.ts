// The settings open in a window of their own. The main window keeps every
// setting, as before, and sends the settings window a snapshot of them as they
// change; the settings window sends back what the user changed there.

import type { SettingsProps } from "../components/Settings";
import type { Accent, Background, Density, ResolvedTheme, Stripes, ThemePreference } from "./appearance";
import type { DownloadPrefs } from "./downloadPrefs";
import type { QueueSettings } from "./engine";
import type { KeyPress } from "../hooks/useShortcuts";
import type { SectionId } from "./sidebar";
import type { SortKey } from "./sort";
import type { SpeedLimit } from "./speedLimit";

/** The settings window's label, which Tauri knows it by. */
export const SETTINGS_WINDOW = "settings";
/** The main window's label. */
export const MAIN_WINDOW = "main";

/** Sent by the settings window once it listens, so the main window sends it the settings. */
export const SETTINGS_READY = "settings://ready";
/** The main window's settings, as a {@link SettingsSnapshot}. */
export const SETTINGS_SNAPSHOT = "settings://snapshot";
/** A change made in the settings window, as a {@link SettingsAction}. */
export const SETTINGS_ACTION = "settings://action";
/** The main window's answer to a request, as a {@link SettingsReply}. */
export const SETTINGS_REPLY = "settings://reply";

/** The page the settings window loads: the same frontend, told which window it is. */
export const SETTINGS_WINDOW_URL = "index.html?window=settings";

/** How the settings window opens. Hidden until it has the settings, so it never shows empty. */
export const SETTINGS_WINDOW_OPTIONS = {
  url: SETTINGS_WINDOW_URL,
  title: "Settings",
  width: 720,
  height: 540,
  minWidth: 560,
  minHeight: 400,
  center: true,
  resizable: true,
  maximizable: false,
  minimizable: false,
  visible: false,
} as const;

/** Whether this page, by its `location.search`, is the settings window. */
export function isSettingsWindow(search: string): boolean {
  return new URLSearchParams(search).get("window") === SETTINGS_WINDOW;
}

/** Everything the settings show, as the main window has it. */
export interface SettingsSnapshot {
  sortOrder: SortKey[];
  pasteMode: "ask" | "always";
  appearance: {
    theme: ThemePreference;
    resolvedTheme: ResolvedTheme;
    accent: Accent;
    background: Background;
    density: Density;
    stripes: Stripes;
  };
  downloadPrefs: DownloadPrefs;
  queueDefaults: QueueSettings;
  sections: { id: SectionId; label: string; shown: boolean }[];
  /** On macOS, once the home folder is known. */
  access: { home: string; fullDisk: boolean; asked: boolean; root: string | null; folders: string[] } | null;
  /** In development only. */
  development: { speedLimit: SpeedLimit } | null;
}

/** What the user did in the settings window, for the main window to do. */
export type SettingsAction =
  | { type: "sortOrder"; order: SortKey[] }
  | { type: "pasteMode"; mode: "ask" | "always" }
  | { type: "theme"; theme: ThemePreference }
  | { type: "accent"; accent: Accent }
  | { type: "background"; background: Background }
  | { type: "density"; density: Density }
  | { type: "stripes"; stripes: Stripes }
  | { type: "downloadPrefs"; prefs: DownloadPrefs }
  | { type: "queueDefaults"; settings: QueueSettings }
  /** Answered with a {@link SettingsReply} carrying the same `request`. */
  | { type: "applyQueueDefaults"; request: number }
  | { type: "sectionShown"; id: SectionId; shown: boolean }
  | { type: "fullDiskAccess" }
  | { type: "restart" }
  | { type: "addFolder" }
  | { type: "removeFolder"; path: string }
  | { type: "resetOnboarding" }
  | { type: "testUpdate"; fails: boolean }
  | { type: "speedLimit"; limit: SpeedLimit };

export type SettingsActionType = SettingsAction["type"];

/** How the main window answers a request: with how many it changed, or why it couldn't. */
export type SettingsReply = { request: number; count: number } | { request: number; error: string };

/** What the main window does for each action. */
export type SettingsHandlers = {
  [K in SettingsActionType]: (action: Extract<SettingsAction, { type: K }>) => void;
};

/**
 * Runs the handler for `action`, as it came from the settings window. Anything
 * that isn't an action is ignored; returns whether one ran.
 */
export function runSettingsAction(action: unknown, handlers: SettingsHandlers): boolean {
  if (typeof action !== "object" || action === null) return false;
  const type = (action as { type?: unknown }).type;
  if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(handlers, type)) return false;
  (handlers[type as SettingsActionType] as (action: SettingsAction) => void)(action as SettingsAction);
  return true;
}

/** Where getit runs, for the settings that only some systems have. */
export interface SettingsPlatform {
  mac: boolean;
  windows: boolean;
}

/**
 * The settings page's props, from the main window's `snapshot`: each change
 * becomes an action `send` passes on, and applying the queue defaults asks
 * `apply`, which resolves with the main window's answer.
 */
export function settingsProps(
  snapshot: SettingsSnapshot,
  platform: SettingsPlatform,
  send: (action: SettingsAction) => void,
  apply: () => Promise<number>,
): SettingsProps {
  const { appearance, downloadPrefs: prefs, access, development } = snapshot;
  const loginShown = platform.mac || platform.windows;
  return {
    sortOrder: snapshot.sortOrder,
    onSortOrder: (order) => send({ type: "sortOrder", order }),
    pasteMode: snapshot.pasteMode,
    onPasteMode: (mode) => send({ type: "pasteMode", mode }),
    appearance: {
      ...appearance,
      onTheme: (theme) => send({ type: "theme", theme }),
      onAccent: (accent) => send({ type: "accent", accent }),
      onBackground: (background) => send({ type: "background", background }),
      onDensity: (density) => send({ type: "density", density }),
      onStripes: (stripes) => send({ type: "stripes", stripes }),
    },
    downloads: {
      prefs,
      onPrefs: (prefs) => send({ type: "downloadPrefs", prefs }),
      canKeepAwake: loginShown,
    },
    login: loginShown
      ? {
          launchAtLogin: prefs.launch_at_login,
          onLaunchAtLogin: (launch_at_login) => send({ type: "downloadPrefs", prefs: { ...prefs, launch_at_login } }),
          waitsIn: platform.windows ? "system tray" : "Dock",
        }
      : undefined,
    tray: platform.windows
      ? {
          closeToTray: prefs.close_to_tray,
          onCloseToTray: (close_to_tray) => send({ type: "downloadPrefs", prefs: { ...prefs, close_to_tray } }),
        }
      : undefined,
    queues: {
      defaults: snapshot.queueDefaults,
      onDefaults: (settings) => send({ type: "queueDefaults", settings }),
      onApply: apply,
    },
    sidebar: {
      sections: snapshot.sections,
      onShown: (id, shown) => send({ type: "sectionShown", id, shown }),
    },
    access:
      platform.mac && access
        ? {
            ...access,
            onFullDiskAccess: () => send({ type: "fullDiskAccess" }),
            onRestart: () => send({ type: "restart" }),
            onAddFolder: () => send({ type: "addFolder" }),
            onRemoveFolder: (path) => send({ type: "removeFolder", path }),
          }
        : undefined,
    development: development
      ? {
          speedLimit: development.speedLimit,
          onSpeedLimit: (limit) => send({ type: "speedLimit", limit }),
          onResetOnboarding: () => send({ type: "resetOnboarding" }),
          onTestUpdate: (fails) => send({ type: "testUpdate", fails }),
        }
      : undefined,
  };
}

/**
 * Requests waiting for the main window's answer. `next` numbers a new one and
 * gives the promise its answer settles; `settle` hands an answer to its request.
 */
export function createRequests() {
  let last = 0;
  const pending = new Map<number, { resolve: (count: number) => void; reject: (error: Error) => void }>();
  return {
    next(): { request: number; answer: Promise<number> } {
      const request = ++last;
      const answer = new Promise<number>((resolve, reject) => pending.set(request, { resolve, reject }));
      return { request, answer };
    },
    /** Returns whether `reply` answered a request still waiting. */
    settle(reply: SettingsReply): boolean {
      const waiting = pending.get(reply.request);
      if (!waiting) return false;
      pending.delete(reply.request);
      if ("error" in reply) waiting.reject(new Error(reply.error));
      else waiting.resolve(reply.count);
      return true;
    },
    get waiting(): number {
      return pending.size;
    },
  };
}

/**
 * Whether a key closes the settings window: Escape, or Command-, (Control on
 * Windows) as it opened them, or Command-W.
 */
export function closesSettingsWindow(e: KeyPress, isMac: boolean): boolean {
  const command = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === "Escape") return !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
  return command && (e.key === "," || e.key.toLowerCase() === "w");
}
