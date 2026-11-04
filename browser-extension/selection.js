// Runs in every page, only to tell the extension whether text is selected, so
// getit's right-click item can say "Download selected with Get it". It says so
// as soon as the selection changes, since Chrome builds the menu straight
// after the right-click, too soon for the title to change then; and again on
// the right-click, for whether it's inside the selection. It reads nothing
// else from the page.

let told = null;
function tell(selected) {
  if (selected === told) return;
  told = selected;
  try {
    // Unanswered: there's nothing to reply.
    Promise.resolve(chrome.runtime.sendMessage({ getitSelection: selected })).catch(() => {});
  } catch {
    // The extension was reloaded; this page's copy of the script is orphaned.
  }
}

/** Whether text is selected in the page or in the focused text field, and, given `target`, whether it's in it. */
function selected(target) {
  const field = document.activeElement;
  if (field && (field.tagName === "INPUT" || field.tagName === "TEXTAREA")) {
    try {
      if (field.selectionStart !== field.selectionEnd) return !target || target === field;
    } catch {
      // Inputs without a text selection (checkboxes and the like).
    }
  }
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;
  return !target || selection.containsNode(target, true);
}

let timer;
document.addEventListener("selectionchange", () => {
  clearTimeout(timer);
  timer = setTimeout(() => tell(selected(null)), 50);
});
// Another tab or frame may have changed the title since.
addEventListener("focus", () => {
  told = null;
  tell(selected(null));
});
addEventListener("contextmenu", (event) => tell(selected(event.target)), true);
