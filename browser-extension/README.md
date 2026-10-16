# getit browser extension

Sends links from the browser to the getit app. The app must be running; it
listens on `http://127.0.0.1:47615` (see `src-tauri/src/browser.rs`) and adds
the links to the folder it has open, asking first unless "Ask before adding
pasted links" is off.

- **Right-click a link:** Download Link with getit
- **Right-click an image, video or audio:** Download with getit
- **Select part of a page and right-click:** Download Links in Selection with getit
- **Toolbar button:** downloads the current page's URL (for a PDF or video the browser opened instead of saving)
- **Send browser downloads to getit** (off by default, in the extension's options): new browser
  downloads are paused and sent to getit; once getit takes them, the browser's copy is cancelled
  and erased from its list. While getit isn't running, the browser downloads as usual. Files
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
