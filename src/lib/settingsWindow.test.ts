import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DOWNLOAD_PREFS } from "./downloadPrefs";
import { parseQueueDefaults } from "./queueSettings";
import {
  closesSettingsWindow,
  createRequests,
  isSettingsWindow,
  runSettingsAction,
  settingsProps,
  SETTINGS_WINDOW_OPTIONS,
  type SettingsAction,
  type SettingsHandlers,
  type SettingsSnapshot,
} from "./settingsWindow";

const snapshot: SettingsSnapshot = {
  sortOrder: ["name"],
  pasteMode: "ask",
  appearance: {
    theme: "System",
    resolvedTheme: "Light",
    accent: "blue",
    background: "default",
    density: "comfortable",
    stripes: "off",
  },
  downloadPrefs: DEFAULT_DOWNLOAD_PREFS,
  queueDefaults: parseQueueDefaults(null),
  sections: [{ id: "favorites", label: "Favorites", shown: true }],
  access: { home: "/Users/me", fullDisk: false, asked: false, root: null, folders: ["/Users/me/Work"] },
  development: null,
};

const mac = { mac: true, windows: false };
const windows = { mac: false, windows: true };
const linux = { mac: false, windows: false };

const props = (platform = mac, s: SettingsSnapshot = snapshot) => {
  const sent: SettingsAction[] = [];
  const apply = vi.fn(() => Promise.resolve(3));
  return { props: settingsProps(s, platform, (a) => sent.push(a), apply), sent, apply };
};

describe("isSettingsWindow", () => {
  it("knows the settings window by its query", () => {
    expect(isSettingsWindow("?window=settings")).toBe(true);
    expect(isSettingsWindow(new URL(`http://localhost/${SETTINGS_WINDOW_OPTIONS.url}`).search)).toBe(true);
  });

  it("takes anything else for the main window", () => {
    expect(isSettingsWindow("")).toBe(false);
    expect(isSettingsWindow("?window=main")).toBe(false);
    expect(isSettingsWindow("?settings")).toBe(false);
  });
});

describe("settingsProps", () => {
  it("shows the snapshot's settings", () => {
    const { props: p } = props();
    expect(p.sortOrder).toEqual(["name"]);
    expect(p.pasteMode).toBe("ask");
    expect(p.appearance.accent).toBe("blue");
    expect(p.appearance.resolvedTheme).toBe("Light");
    expect(p.downloads.prefs).toBe(DEFAULT_DOWNLOAD_PREFS);
    expect(p.queues.defaults).toBe(snapshot.queueDefaults);
    expect(p.sidebar.sections).toBe(snapshot.sections);
    expect(p.access?.folders).toEqual(["/Users/me/Work"]);
  });

  it("sends each change back as an action", () => {
    const { props: p, sent } = props();
    p.onSortOrder(["size", "name"]);
    p.onPasteMode("always");
    p.appearance.onTheme("Dark");
    p.appearance.onAccent("green");
    p.appearance.onBackground("default");
    p.appearance.onDensity("compact");
    p.appearance.onStripes("on");
    p.sidebar.onShown("favorites", false);
    p.access?.onRemoveFolder("/Users/me/Work");
    p.access?.onAddFolder();
    p.access?.onFullDiskAccess();
    p.access?.onRestart();
    expect(sent).toEqual([
      { type: "sortOrder", order: ["size", "name"] },
      { type: "pasteMode", mode: "always" },
      { type: "theme", theme: "Dark" },
      { type: "accent", accent: "green" },
      { type: "background", background: "default" },
      { type: "density", density: "compact" },
      { type: "stripes", stripes: "on" },
      { type: "sectionShown", id: "favorites", shown: false },
      { type: "removeFolder", path: "/Users/me/Work" },
      { type: "addFolder" },
      { type: "fullDiskAccess" },
      { type: "restart" },
    ]);
  });

  it("sends the whole download preferences with the one that changed", () => {
    const { props: p, sent } = props(windows);
    p.login?.onLaunchAtLogin(false);
    p.tray?.onCloseToTray(false);
    expect(sent).toEqual([
      { type: "downloadPrefs", prefs: { ...DEFAULT_DOWNLOAD_PREFS, launch_at_login: false } },
      { type: "downloadPrefs", prefs: { ...DEFAULT_DOWNLOAD_PREFS, close_to_tray: false } },
    ]);
  });

  it("applies the queue defaults through the main window", async () => {
    const { props: p, apply } = props();
    await expect(p.queues.onApply()).resolves.toBe(3);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("shows startup on macOS and Windows, the tray only on Windows, folder access only on macOS", () => {
    expect(props(mac).props.login?.waitsIn).toBe("Dock");
    expect(props(mac).props.tray).toBeUndefined();
    expect(props(windows).props.login?.waitsIn).toBe("system tray");
    expect(props(windows).props.tray).toBeDefined();
    expect(props(windows).props.access).toBeUndefined();
    expect(props(linux).props.login).toBeUndefined();
    expect(props(linux).props.downloads.canKeepAwake).toBe(false);
    expect(props(mac).props.downloads.canKeepAwake).toBe(true);
  });

  it("shows folder access only once the main window knows it", () => {
    expect(props(mac, { ...snapshot, access: null }).props.access).toBeUndefined();
  });

  it("shows the development page only when the snapshot has it", () => {
    expect(props().props.development).toBeUndefined();
    const { props: p, sent } = props(mac, { ...snapshot, development: { speedLimit: "off" } });
    expect(p.development?.speedLimit).toBe("off");
    p.development?.onSpeedLimit("1m");
    p.development?.onTestUpdate(true);
    p.development?.onResetOnboarding();
    expect(sent).toEqual([
      { type: "speedLimit", limit: "1m" },
      { type: "testUpdate", fails: true },
      { type: "resetOnboarding" },
    ]);
  });
});

describe("runSettingsAction", () => {
  const handlers = () =>
    Object.fromEntries(
      (
        [
          "sortOrder",
          "pasteMode",
          "theme",
          "accent",
          "background",
          "density",
          "stripes",
          "downloadPrefs",
          "queueDefaults",
          "applyQueueDefaults",
          "sectionShown",
          "fullDiskAccess",
          "restart",
          "addFolder",
          "removeFolder",
          "resetOnboarding",
          "testUpdate",
          "speedLimit",
        ] as const
      ).map((type) => [type, vi.fn()]),
    ) as unknown as SettingsHandlers & Record<string, ReturnType<typeof vi.fn>>;

  it("runs the action's handler with the action", () => {
    const h = handlers();
    expect(runSettingsAction({ type: "accent", accent: "green" }, h)).toBe(true);
    expect(h.accent).toHaveBeenCalledWith({ type: "accent", accent: "green" });
    expect(h.theme).not.toHaveBeenCalled();
  });

  it("ignores what isn't an action", () => {
    const h = handlers();
    expect(runSettingsAction(null, h)).toBe(false);
    expect(runSettingsAction("accent", h)).toBe(false);
    expect(runSettingsAction({}, h)).toBe(false);
    expect(runSettingsAction({ type: "nope" }, h)).toBe(false);
    expect(runSettingsAction({ type: "toString" }, h)).toBe(false);
  });
});

describe("createRequests", () => {
  it("numbers each request and settles it with its answer", async () => {
    const requests = createRequests();
    const first = requests.next();
    const second = requests.next();
    expect(first.request).not.toBe(second.request);
    expect(requests.waiting).toBe(2);
    expect(requests.settle({ request: second.request, count: 4 })).toBe(true);
    expect(requests.settle({ request: first.request, error: "disk full" })).toBe(true);
    await expect(second.answer).resolves.toBe(4);
    await expect(first.answer).rejects.toThrow("disk full");
    expect(requests.waiting).toBe(0);
  });

  it("ignores answers to nothing waiting", () => {
    const requests = createRequests();
    const { request } = requests.next();
    expect(requests.settle({ request: request + 1, count: 1 })).toBe(false);
    expect(requests.settle({ request, count: 1 })).toBe(true);
    expect(requests.settle({ request, count: 1 })).toBe(false);
  });
});

describe("closesSettingsWindow", () => {
  const key = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("closes on Escape, and Command-, or Command-W on macOS", () => {
    expect(closesSettingsWindow(key("Escape"), true)).toBe(true);
    expect(closesSettingsWindow(key(",", { metaKey: true }), true)).toBe(true);
    expect(closesSettingsWindow(key("w", { metaKey: true }), true)).toBe(true);
    expect(closesSettingsWindow(key("W", { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(closesSettingsWindow(key(",", { ctrlKey: true }), true)).toBe(false);
  });

  it("takes Control for Command elsewhere", () => {
    expect(closesSettingsWindow(key(",", { ctrlKey: true }), false)).toBe(true);
    expect(closesSettingsWindow(key("w", { ctrlKey: true }), false)).toBe(true);
    expect(closesSettingsWindow(key(",", { metaKey: true }), false)).toBe(false);
  });

  it("leaves other keys alone", () => {
    expect(closesSettingsWindow(key(","), true)).toBe(false);
    expect(closesSettingsWindow(key("w"), true)).toBe(false);
    expect(closesSettingsWindow(key("Escape", { shiftKey: true }), true)).toBe(false);
    expect(closesSettingsWindow(key("a", { metaKey: true }), true)).toBe(false);
  });
});
