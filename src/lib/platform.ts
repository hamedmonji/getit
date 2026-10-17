/** On macOS, Control-click opens the context menu and Command adds to the selection. */
export const IS_MAC = navigator.userAgent.includes("Mac");

/** Prefix for keyboard shortcuts shown in menus. */
export const MOD = IS_MAC ? "⌘" : "Ctrl+";
export const FILE_MANAGER = IS_MAC ? "Finder" : navigator.userAgent.includes("Windows") ? "Explorer" : "File Manager";
