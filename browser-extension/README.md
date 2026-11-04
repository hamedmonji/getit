# getit browser extension

Sends links from the browser to the getit app. If the app isn't running, the
extension starts it and sends the links once it's up. It starts it through the
native messaging host getit registers with each installed browser whenever it
runs (`src-tauri/src/native_host.rs`), so it needs no tab or prompt; until getit
has run once, it opens a `getit://` link instead, which the browser asks about. The app
listens on `http://127.0.0.1:47615` (see `src-tauri/src/browser.rs`) and shows
the links it receives at the bottom of its window as captured, with an "Add here"
button that adds them to the folder you're in.

- **Right-click a link, image, video or audio:** Download with Get it (a linked image downloads what it links to)
- **Select part of a page and right-click it:** Download selected with Get it, for the links in the selection,
  a link inside it included. It's one menu item whose title changes, so the browser never puts it in a
  submenu: `selection.js`, which runs in every page, tells the extension whenever text is selected or
  unselected, ahead of the right-click since Chrome builds the menu too quickly to change it then, and
  reads nothing else. It's why the browser says on install that the
  extension can read and change data on all websites.
- **Toolbar button:** pauses and resumes catching browser downloads (the option below); it shows "off" while paused
- **Send browser downloads to getit** (on by default; can be turned off in the extension's options): new browser
  downloads are paused and sent to getit; once getit takes them, the browser's copy is cancelled
  and erased from its list. If getit isn't running it's started first; if it can't start, the
  browser downloads as usual. Files
  behind a login may fail in getit, since it doesn't share the browser's cookies.

The app only accepts requests from extension origins
(`chrome-extension://`, `moz-extension://`), so a website can't add downloads by
calling the port.

## Install (unpacked)

**Chrome / Edge / Brave:** open `chrome://extensions`, turn on Developer mode,
click "Load unpacked" and pick this folder.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load Temporary
Add-on…" and pick `manifest.json`.

After editing the files, click the reload button on the extension's card.

The `key` in `manifest.json` fixes the extension's id
(`keiophbnadjdajmllmohammiflcdpfmo`), which the native host manifest allows by
name; changing the key means changing `CHROME_EXTENSION_ID` in
`src-tauri/src/native_host.rs` too.
