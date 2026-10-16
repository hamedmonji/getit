// Sends links to the getit app, which listens on localhost
// (src-tauri/src/browser.rs). The app shows them as captured until the user
// adds them to a folder.

// Must match `PORT` in src-tauri/src/browser.rs.
const PORT = 47615;
const APP = `http://127.0.0.1:${PORT}`;

const MENU_LINK = "getit-link";
const MENU_MEDIA = "getit-media";
const MENU_SELECTION = "getit-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_LINK, title: "Download Link with getit", contexts: ["link"] });
    chrome.contextMenus.create({
      id: MENU_MEDIA,
      title: "Download with getit",
      contexts: ["image", "video", "audio"],
    });
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: "Download Links in Selection with getit",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case MENU_LINK:
      return send([info.linkUrl]);
    case MENU_MEDIA:
      return send([info.srcUrl]);
    case MENU_SELECTION:
      return send(await selectedLinks(tab, info.frameId ?? 0));
  }
});

// The toolbar button downloads the page itself, which suits files the browser
// opened instead of saving (PDFs, videos, archives served inline).
chrome.action.onClicked.addListener((tab) => send([tab.url]));

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

// When "Send browser downloads to getit" is on (options.html), new browser
// downloads are paused and offered to getit. If getit takes them, the browser's
// copy is cancelled and erased from its list; otherwise it carries on, so
// nothing is lost while the app isn't running.
chrome.downloads.onCreated.addListener(async (item) => {
  const { takeOver } = await chrome.storage.local.get({ takeOver: false });
  const url = item.finalUrl || item.url;
  if (!takeOver || item.state !== "in_progress" || !/^https?:/i.test(url)) return;
  await chrome.downloads.pause(item.id).catch(() => {});
  // Small files can finish before the pause lands; the browser already has those.
  const [now] = await chrome.downloads.search({ id: item.id });
  if (now?.state !== "in_progress") return;
  try {
    await post([url]);
  } catch {
    await chrome.downloads.resume(item.id).catch(() => {});
    return;
  }
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  flashBadge("✓", "#2e7d32");
});

/** Sends `urls` to the app; rejects if it isn't running or refuses them. */
async function post(urls) {
  const response = await fetch(`${APP}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
}

async function send(urls) {
  urls = urls.filter((url) => url && /^https?:/i.test(url));
  if (!urls.length) {
    notify("Nothing to download", "getit only downloads http and https links.");
    return;
  }
  try {
    await post(urls);
    flashBadge("✓", "#2e7d32");
  } catch (e) {
    flashBadge("!", "#c62828");
    const unreachable = e instanceof TypeError;
    notify(
      unreachable ? "getit isn't running" : "getit couldn't add the links",
      unreachable ? "Open the getit app and try again." : String(e.message ?? e),
    );
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
  });
}
