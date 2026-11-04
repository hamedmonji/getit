import { DEFAULT_OPTIONS } from "./menu.js";

// Must match `PORT` in background.js.
const PORT = 47615;

const takeOver = document.getElementById("takeOver");
const status = document.getElementById("status");

chrome.storage.local.get(DEFAULT_OPTIONS).then((options) => {
  takeOver.checked = options.takeOver;
});
takeOver.addEventListener("change", () => chrome.storage.local.set({ takeOver: takeOver.checked }));

fetch(`http://127.0.0.1:${PORT}/ping`)
  .then((response) => {
    status.textContent = response.ok ? "● getit is running." : `getit answered with HTTP ${response.status}.`;
  })
  .catch(() => {
    status.textContent = "○ getit isn't running.";
  });

// The toolbar button changes it too.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "takeOver" in changes) takeOver.checked = changes.takeOver.newValue;
});
