// The minimize, maximize and close buttons drawn in the toolbar on Windows,
// where getit hides the system's title bar so the toolbar can take its place.

export type CaptionAction = "minimize" | "toggleMaximize" | "close";

export interface CaptionButton {
  action: CaptionAction;
  /** Its tooltip and accessible name, as Windows words them. */
  label: string;
  /** Its glyph in Segoe Fluent Icons (Windows 11) and Segoe MDL2 Assets (Windows 10). */
  glyph: string;
}

/** The caption buttons in order, the middle one restoring a maximized window. */
export function captionButtons(maximized: boolean): CaptionButton[] {
  return [
    { action: "minimize", label: "Minimize", glyph: "" },
    maximized
      ? { action: "toggleMaximize", label: "Restore Down", glyph: "" }
      : { action: "toggleMaximize", label: "Maximize", glyph: "" },
    { action: "close", label: "Close", glyph: "" },
  ];
}
