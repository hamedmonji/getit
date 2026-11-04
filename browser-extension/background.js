// Sends links to the getit app, which listens on localhost
// (src-tauri/src/browser.rs). The app shows them as captured until the user
// adds them to a folder.

import { buttonLook, clickedTarget, DEFAULT_OPTIONS, MENU_CONTEXTS, MENU_ID, menuTitle } from "./menu.js";

// Must match `PORT` in src-tauri/src/browser.rs.
const PORT = 47615;
const APP = `http://127.0.0.1:${PORT}`;
// Registered by the app (src-tauri/src/native_host.rs); asking it to run
// starts getit without a tab or a prompt.
const NATIVE_HOST = "com.hamedmonji.getit";
// Registered by the app (`deep-link` in src-tauri/tauri.conf.json); opening it
// starts getit, for when the native host isn't registered.
const LAUNCH_URL = "getit://open";
// How long to wait for getit to start before giving up.
const LAUNCH_TIMEOUT_MS = 20000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: menuTitle(false), contexts: MENU_CONTEXTS });
  });
});

// selection.js says whenever text is selected or unselected, and again on the
// right-click, and the title follows. Firefox also says so itself.
// null after the browser restarts this script, so the first update always lands.
let titledSelection = null;
function retitle(inSelection) {
  if (inSelection === titledSelection) return;
  titledSelection = inSelection;
  chrome.contextMenus.update(MENU_ID, { title: menuTitle(inSelection) });
}
chrome.runtime.onMessage.addListener((message) => {
  if (typeof message?.getitSelection === "boolean") retitle(message.getitSelection);
});
const menus = globalThis.browser?.menus;
menus?.onShown.addListener((info) => {
  retitle(info.contexts.includes("selection"));
  menus.refresh();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const target = clickedTarget(info);
  const urls = target.selection ? await selectedLinks(tab, info.frameId ?? 0) : target.urls;
  return send(urls, tab?.title);
});

// The toolbar button pauses and resumes catching browser downloads, the same
// setting as "Send browser downloads to getit" in options.html.
chrome.action.onClicked.addListener(async () => {
  const { takeOver } = await chrome.storage.local.get(DEFAULT_OPTIONS);
  await chrome.storage.local.set({ takeOver: !takeOver });
});

async function catching() {
  return (await chrome.storage.local.get(DEFAULT_OPTIONS)).takeOver;
}

/** Shows on the toolbar button whether downloads are being caught. */
async function showCatching() {
  const look = buttonLook(await catching());
  chrome.action.setTitle({ title: look.title });
  chrome.action.setBadgeBackgroundColor({ color: look.color });
  chrome.action.setBadgeText({ text: look.badge });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "takeOver" in changes) showCatching();
});
chrome.runtime.onInstalled.addListener(showCatching);
chrome.runtime.onStartup.addListener(showCatching);

/** Links inside the selection in `tab`, plus any URLs written out in its text. */
async function selectedLinks(tab, frameId) {
  if (!tab?.id) return [];
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: linksInSelection,
    });
    return result?.result ?? [];
  } catch (e) {
    notify("Couldn't read the selection", String(e?.message ?? e));
    return [];
  }
}

// Runs in the page.
function linksInSelection() {
  const selection = getSelection();
  const urls = new Set();
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    const node = range.commonAncestorContainer;
    const root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!root) continue;
    const around = root.closest("a[href]");
    if (around) urls.add(around.href);
    for (const a of root.querySelectorAll("a[href]")) {
      if (range.intersectsNode(a)) urls.add(a.href);
    }
  }
  for (const match of selection.toString().matchAll(/https?:\/\/[^\s<>"']+/gi)) urls.add(match[0]);
  return [...urls].filter((url) => /^https?:/i.test(url));
}

// When "Send browser downloads to getit" is on (options.html, on unless the
// user turns it off), new browser
// downloads are paused and offered to getit, starting it if it isn't running.
// If getit takes them, the browser's copy is cancelled and erased from its
// list; otherwise it carries on, so nothing is lost when getit can't start.
chrome.downloads.onCreated.addListener(async (item) => {
  const { takeOver } = await chrome.storage.local.get(DEFAULT_OPTIONS);
  const url = item.finalUrl || item.url;
  if (!takeOver || item.state !== "in_progress" || !/^https?:/i.test(url)) return;
  await chrome.downloads.pause(item.id).catch(() => {});
  // Small files can finish before the pause lands; the browser already has those.
  const [now] = await chrome.downloads.search({ id: item.id });
  if (now?.state !== "in_progress") return;
  try {
    await postStarting([url]);
  } catch {
    await chrome.downloads.resume(item.id).catch(() => {});
    return;
  }
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  flashBadge("✓", "#2e7d32");
});

/**
 * Sends `urls` to the app, with the title of their page, which getit uses to
 * pick a folder. Rejects if the app isn't running or refuses them.
 */
async function post(urls, title) {
  const response = await fetch(`${APP}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, title: title || null }),
  });
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
}

async function send(urls, title) {
  urls = urls.filter((url) => url && /^https?:/i.test(url));
  if (!urls.length) {
    notify("Nothing to download", "getit only downloads http and https links.");
    return;
  }
  try {
    await postStarting(urls, title);
    flashBadge("✓", "#2e7d32");
  } catch (e) {
    flashBadge("!", "#c62828");
    if (e instanceof LaunchError) {
      notify("Couldn't start getit", "Open the getit app and try again. If the browser asked to open getit, allow it.");
    } else {
      notify("getit couldn't add the links", String(e.message ?? e));
    }
  }
}

class LaunchError extends Error {}

/**
 * Like `post`, but starts getit first if it isn't running. Rejects with a
 * `LaunchError` if it doesn't start.
 */
async function postStarting(urls, title) {
  try {
    return await post(urls, title);
  } catch (e) {
    // A TypeError means nothing is listening; anything else came from getit.
    if (!(e instanceof TypeError)) throw e;
  }
  if (!(await launchApp())) throw new LaunchError("getit didn't start");
  return post(urls, title);
}

let launching = null;

/**
 * Starts getit and resolves with whether it answered within
 * `LAUNCH_TIMEOUT_MS`. Sends made while it starts share one launch.
 */
function launchApp() {
  launching ??= (async () => {
    // The native host starts it quietly; it's registered once getit has run.
    const started = await chrome.runtime
      .sendNativeMessage(NATIVE_HOST, { launch: true })
      .then((reply) => reply?.ok === true)
      .catch(() => false);
    // Otherwise the link scheme does. The browser hands the link to the OS
    // from a tab, asking first unless the user chose to always allow it, so
    // the tab has to be visible.
    const tab = started ? null : await chrome.tabs.create({ url: LAUNCH_URL, active: true }).catch(() => null);
    try {
      return await waitForApp(LAUNCH_TIMEOUT_MS);
    } finally {
      if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
      launching = null;
    }
  })();
  return launching;
}

async function waitForApp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any answer means getit is listening. Its status can't be relied on:
      // the browser may leave out the Origin header on a GET, which getit
      // refuses.
      await fetch(`${APP}/ping`);
      return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Shows `text` on the toolbar button for a moment, then whether downloads are being caught again. */
function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(showCatching, 2500);
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
  });
}
