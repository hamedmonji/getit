// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { shortcutFor, useShortcuts, type KeyPress, type ShortcutAction, type ShortcutContext } from "./useShortcuts";

const mac: ShortcutContext = { isMac: true, settingsOpen: false, selectionCount: 0, onButton: false, typing: false };
const other: ShortcutContext = { ...mac, isMac: false };

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const cmd = (key: string, mods: Partial<KeyPress> = {}) => press(key, { metaKey: true, ...mods });
const ctrl = (key: string, mods: Partial<KeyPress> = {}) => press(key, { ctrlKey: true, ...mods });

/** The action a key press runs, or null when it does nothing. */
const action = (e: KeyPress, ctx = mac) => shortcutFor(e, ctx)?.action ?? null;

describe("shortcutFor", () => {
  it("maps Command shortcuts on macOS", () => {
    expect(action(cmd("v"))).toBe("paste");
    expect(action(cmd("["))).toBe("back");
    expect(action(cmd("]"))).toBe("forward");
    expect(action(cmd("o"))).toBe("overview");
    expect(action(cmd(","))).toBe("settings");
    expect(action(cmd("/"))).toBe("queuePanel");
    expect(action(cmd("1"))).toBe("icons");
    expect(action(cmd("2"))).toBe("list");
    expect(action(cmd("."))).toBe("toggleFolders");
    expect(action(cmd("n"))).toBe("newQueue");
    expect(action(cmd("z"))).toBe("undo");
    expect(action(cmd("a"))).toBe("selectAll");
    expect(action(cmd("Backspace"))).toBe("trash");
  });

  it("uses Control in place of Command elsewhere", () => {
    expect(action(ctrl("v"), other)).toBe("paste");
    expect(action(cmd("v"), other)).toBeNull();
    expect(action(ctrl("v"), mac)).toBeNull();
  });

  it("ignores letter case, as with Caps Lock", () => {
    expect(action(cmd("V"))).toBe("paste");
  });

  it("finds Command-/ by its key code on layouts where / needs Shift", () => {
    expect(action(cmd("7", { code: "Slash" }))).toBe("queuePanel");
    expect(action(cmd("/", { shiftKey: true }))).toBeNull();
  });

  it("cuts and copies only with something selected", () => {
    expect(action(cmd("c"))).toBeNull();
    expect(action(cmd("c"), { ...mac, selectionCount: 2 })).toBe("copy");
    expect(action(cmd("x"), { ...mac, selectionCount: 2 })).toBe("cut");
  });

  it("opens the search with Command-F, Command-L or a plain /", () => {
    expect(action(cmd("f"))).toBe("search");
    expect(action(cmd("l"))).toBe("search");
    expect(action(press("/"))).toBe("search");
  });

  it("removes with Delete or Backspace alone", () => {
    expect(action(press("Delete"))).toBe("remove");
    expect(action(press("Backspace"))).toBe("remove");
  });

  describe("arrows", () => {
    it("move the selection, with or without Shift", () => {
      expect(action(press("ArrowDown"))).toBe("moveSelection");
      expect(action(press("ArrowLeft", { shiftKey: true }))).toBe("moveSelection");
    });

    it("go up with Command-Up, or Alt-Up elsewhere", () => {
      expect(action(cmd("ArrowUp"))).toBe("goUp");
      expect(action(press("ArrowUp", { altKey: true }), other)).toBe("goUp");
    });

    it("open the selected item with Command-Down, only with one selected", () => {
      expect(action(cmd("ArrowDown"), { ...mac, selectionCount: 1 })).toBe("openSelected");
      expect(action(cmd("ArrowDown"), { ...mac, selectionCount: 2 })).toBeNull();
    });

    it("swallow other Command-arrows, so the page doesn't scroll", () => {
      expect(shortcutFor(cmd("ArrowLeft"), mac)).toEqual({ action: null, preventDefault: true });
    });

    it("leave arrows with other modifiers alone", () => {
      expect(shortcutFor(press("ArrowDown", { ctrlKey: true }), mac)).toBeNull();
    });
  });

  describe("Return", () => {
    const one = { ...mac, selectionCount: 1 };

    it("renames the one selected item", () => {
      expect(action(press("Enter"), one)).toBe("rename");
    });

    it("does nothing with no selection, several, a modifier, or a focused button", () => {
      expect(action(press("Enter"))).toBeNull();
      expect(action(press("Enter"), { ...mac, selectionCount: 2 })).toBeNull();
      expect(action(press("Enter", { shiftKey: true }), one)).toBeNull();
      expect(action(press("Enter"), { ...one, onButton: true })).toBeNull();
    });
  });

  describe("Space", () => {
    it("shows or hides the details", () => {
      expect(shortcutFor(press(" "), mac)).toEqual({ action: "details", preventDefault: true });
    });

    it("does nothing with a modifier or a focused button", () => {
      expect(action(press(" ", { shiftKey: true }))).toBeNull();
      expect(action(cmd(" "))).toBeNull();
      expect(action(press(" "), { ...mac, onButton: true })).toBeNull();
    });
  });

  describe("typing a name", () => {
    it("selects by name with plain characters, capitals and digits", () => {
      expect(shortcutFor(press("d"), mac)).toEqual({ action: "typeSelect", preventDefault: true });
      expect(action(press("D", { shiftKey: true }))).toBe("typeSelect");
      expect(action(press("7"))).toBe("typeSelect");
      expect(action(press("é"))).toBe("typeSelect");
    });

    it("leaves modified and named keys alone", () => {
      expect(action(press("d", { altKey: true }))).toBeNull();
      expect(action(ctrl("d"))).toBeNull();
      expect(action(press("Tab"))).toBeNull();
      expect(action(press("F1"))).toBeNull();
    });

    it("keeps / for search", () => {
      expect(action(press("/"))).toBe("search");
    });

    it("takes Space as part of a name only while typing one", () => {
      expect(action(press(" "), { ...mac, typing: true })).toBe("typeSelect");
      expect(action(press(" "))).toBe("details");
    });
  });

  it("passes Escape on without stopping the browser's handling", () => {
    expect(shortcutFor(press("Escape"), mac)).toEqual({ action: "escape", preventDefault: false });
  });

  it("stops the browser's handling for Command shortcuts", () => {
    expect(shortcutFor(cmd("z"), mac)?.preventDefault).toBe(true);
    expect(shortcutFor(cmd("Backspace"), mac)?.preventDefault).toBe(false);
  });

  it("only closes the settings while they're open", () => {
    const open = { ...mac, settingsOpen: true, selectionCount: 1 };
    expect(action(press("Escape"), open)).toBe("closeSettings");
    expect(action(cmd(","), open)).toBe("closeSettings");
    expect(shortcutFor(cmd("v"), open)).toBeNull();
    expect(shortcutFor(press("Backspace"), open)).toBeNull();
  });

  it("ignores other keys", () => {
    expect(shortcutFor(press("Home"), mac)).toBeNull();
    expect(shortcutFor(cmd("q"), mac)).toBeNull();
  });
});

describe("useShortcuts", () => {
  /** Presses Escape on `target`, with the hook listening, and says whether its handler ran. */
  const escapeRuns = (target: Element) => {
    const escape = vi.fn();
    const handlers = { escape } as unknown as Record<ShortcutAction, (e: KeyboardEvent) => void>;
    const hook = renderHook(() => useShortcuts({ settingsOpen: false, selectionCount: 0, typing: () => false }, handlers));
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    hook.unmount();
    return escape.mock.calls.length > 0;
  };

  it("runs a shortcut pressed outside any menu", () => {
    expect(escapeRuns(document.body)).toBe(true);
  });

  it("leaves keys pressed in an open menu to the menu", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = menu.appendChild(document.createElement("div"));
    document.body.append(menu);
    expect(escapeRuns(item)).toBe(false);
    menu.remove();
  });

  /** Types "a" on `target`, with the hook listening, and says whether it selected by name. */
  const typeSelects = (target: Element) => {
    const typeSelect = vi.fn();
    const handlers = { typeSelect } as unknown as Record<ShortcutAction, (e: KeyboardEvent) => void>;
    const hook = renderHook(() => useShortcuts({ settingsOpen: false, selectionCount: 0, typing: () => false }, handlers));
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    hook.unmount();
    return typeSelect.mock.calls.length > 0;
  };

  it("selects by name from typing outside text fields and dialogs", () => {
    expect(typeSelects(document.body)).toBe(true);

    const textarea = document.body.appendChild(document.createElement("textarea"));
    expect(typeSelects(textarea)).toBe(false);
    textarea.remove();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = dialog.appendChild(document.createElement("button"));
    document.body.append(dialog);
    expect(typeSelects(button)).toBe(false);
    dialog.remove();
  });

  it("leaves a key that something already handled, like the Escape that closes a dialog", () => {
    const handle = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener("keydown", handle, true);
    expect(escapeRuns(document.body)).toBe(false);
    document.removeEventListener("keydown", handle, true);
  });
});
