// What the extension's right-click menu offers, and the options it starts
// with. Kept apart from background.js so it can be tested.

/** The options before the user changes them (options.html). */
export const DEFAULT_OPTIONS = { takeOver: true };

/**
 * getit's one right-click item. A single item, so the browser never folds it
 * into a getit submenu; its title says what a click will download.
 */
export const MENU_ID = "getit-download";
export const MENU_CONTEXTS = ["link", "image", "video", "audio", "selection"];

/** The item's title, for a right-click inside a selection or not. */
export function menuTitle(inSelection) {
  return inSelection ? "Download selected with Get it" : "Download with Get it";
}

/**
 * What a click on the item downloads, from what the browser says was
 * right-clicked: the links in the selection when there is one (a link inside
 * it too), else the link, so a linked image downloads what it links to, else
 * the media.
 */
export function clickedTarget(info) {
  if (info.selectionText) return { selection: true, urls: [] };
  const url = info.linkUrl || info.srcUrl;
  return { selection: false, urls: url ? [url] : [] };
}

/**
 * The toolbar button, which pauses and resumes catching browser downloads:
 * its tooltip says what a click does, and its badge shows when it's paused.
 */
export function buttonLook(catching) {
  return catching
    ? { title: "Catching downloads for Get it. Click to pause.", badge: "", color: "#6b6b6b" }
    : { title: "Catching downloads is paused. Click to resume.", badge: "off", color: "#6b6b6b" };
}
