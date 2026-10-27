import { useEffect, useRef } from "react";
import { IS_MAC } from "../lib/platform";

export type ShortcutAction =
  | "closeSettings"
  | "goUp"
  | "openSelected"
  | "moveSelection"
  | "trash"
  | "remove"
  | "paste"
  | "cut"
  | "copy"
  | "back"
  | "forward"
  | "details"
  | "overview"
  | "settings"
  | "queuePanel"
  | "icons"
  | "list"
  | "toggleFolders"
  | "newQueue"
  | "search"
  | "rename"
  | "escape"
  | "undo"
  | "selectAll"
  | "typeSelect";

export type KeyPress = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export interface ShortcutContext {
  isMac: boolean;
  settingsOpen: boolean;
  /** How many items are selected in view. */
  selectionCount: number;
  /** Whether a button has focus, which takes Return and Space itself. */
  onButton: boolean;
  /** Whether the user is typing a name to select, so a space is part of it. */
  typing: boolean;
}

/** What a key does, and whether the browser's own handling is stopped. Null `action` swallows the key. */
export interface Shortcut {
  action: ShortcutAction | null;
  preventDefault: boolean;
}

/**
 * The shortcut for a key press, if any.
 *
 * Command-X and Command-C cut and copy the selection, for pasting elsewhere;
 * Command-N makes a new folder with its own queue; Command-[ and Command-]
 * go back and forward; Command-. shows or hides folders without downloads;
 * Command-1 and Command-2 switch to icons and list; Command-O shows or hides the overview,
 * Command-, the settings, and Command-/ the queue settings panel;
 * Command-Delete moves the selection to the Trash; Delete/Backspace alone
 * removes the selected downloads from the list (finished files stay);
 * Command-A selects everything in the folder; Command-Down opens the selected
 * item and Command-Up goes to the enclosing folder (Control-A and Alt-arrows elsewhere);
 * Return renames the selected folder or file, as in Finder; Space shows or hides the
 * download details; / opens the search, like Command-F and Command-L. Other
 * characters, typed without Command, Control or Option, select the item by
 * name, as in Finder; while typing one, Space is part of the name.
 */
export function shortcutFor(e: KeyPress, ctx: ShortcutContext): Shortcut | null {
  const command = ctx.isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();
  const prevent = (action: ShortcutAction | null): Shortcut => ({ action, preventDefault: true });
  const plain = (action: ShortcutAction): Shortcut => ({ action, preventDefault: false });

  // The settings dialog covers the window; only its own keys work.
  if (ctx.settingsOpen) return e.key === "Escape" || (e.key === "," && command) ? prevent("closeSettings") : null;

  const arrow = e.key.startsWith("Arrow");
  if (arrow && (ctx.isMac ? e.metaKey : e.altKey)) {
    if (e.key === "ArrowUp") return prevent("goUp");
    if (e.key === "ArrowDown" && ctx.selectionCount === 1) return prevent("openSelected");
    return prevent(null);
  }
  if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey) return prevent("moveSelection");
  if ((e.key === "Delete" || e.key === "Backspace") && command) return plain("trash");
  if (e.key === "Delete" || e.key === "Backspace") return plain("remove");
  if (key === "v" && command) return prevent("paste");
  if ((key === "c" || key === "x") && command && ctx.selectionCount) return prevent(key === "x" ? "cut" : "copy");
  if ((e.key === "[" || e.key === "]") && command) return prevent(e.key === "[" ? "back" : "forward");
  if (key === "o" && command) return prevent("overview");
  if (e.key === "," && command) return prevent("settings");
  if ((e.key === "/" || e.code === "Slash") && command && !e.shiftKey) return prevent("queuePanel");
  if ((e.key === "1" || e.key === "2") && command) return prevent(e.key === "1" ? "icons" : "list");
  if (e.key === "." && command) return prevent("toggleFolders");
  if (key === "n" && command) return prevent("newQueue");
  if (((key === "f" || key === "l") && command) || (e.key === "/" && !(e.metaKey || e.ctrlKey || e.altKey))) {
    return prevent("search");
  }
  if (
    e.key === "Enter" &&
    !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) &&
    !ctx.onButton &&
    ctx.selectionCount === 1
  ) {
    return prevent("rename");
  }
  // One character, so not a named key such as Tab or F1.
  const printable = [...e.key].length === 1 && !(e.metaKey || e.ctrlKey || e.altKey);
  if (printable && (e.key !== " " || ctx.typing)) return prevent("typeSelect");
  if (e.key === " " && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) && !ctx.onButton) {
    return prevent("details");
  }
  if (e.key === "Escape") return plain("escape");
  if (key === "z" && command && !e.shiftKey) return prevent("undo");
  if (key === "a" && command) return prevent("selectAll");
  return null;
}

interface Options {
  settingsOpen: boolean;
  selectionCount: number;
  /** Whether the user is typing a name to select, asked as each key comes. */
  typing: () => boolean;
}

/**
 * Runs `handlers` for the window's keyboard shortcuts. Text fields and open menus
 * keep their keys, and so does a key something already handled, such as the
 * Escape that closes a menu or dialog. Typing in a dialog selects nothing behind it.
 */
export function useShortcuts(options: Options, handlers: Record<ShortcutAction, (e: KeyboardEvent) => void>) {
  const latest = useRef({ options, handlers });
  latest.current = { options, handlers };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { options, handlers } = latest.current;
      const target = e.target instanceof Element ? e.target : null;
      const inMenu = !!target?.closest('[role="menu"]');
      const inText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (inText || inMenu || e.defaultPrevented) return;
      const shortcut = shortcutFor(e, {
        isMac: IS_MAC,
        settingsOpen: options.settingsOpen,
        selectionCount: options.selectionCount,
        onButton: e.target instanceof HTMLButtonElement,
        typing: options.typing(),
      });
      if (!shortcut || (shortcut.action === "typeSelect" && target?.closest('[role="dialog"]'))) return;
      if (shortcut.preventDefault) e.preventDefault();
      if (shortcut.action) handlers[shortcut.action](e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
