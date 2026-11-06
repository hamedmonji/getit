import { describe, expect, it } from "vitest";
import { captionButtons } from "./windowControls";

describe("captionButtons", () => {
  it("minimizes, maximizes and closes, in Windows' order", () => {
    expect(captionButtons(false).map((b) => b.action)).toEqual(["minimize", "toggleMaximize", "close"]);
    expect(captionButtons(false)[1]).toMatchObject({ label: "Maximize", glyph: "" });
  });

  it("restores a maximized window", () => {
    expect(captionButtons(true)[1]).toMatchObject({ action: "toggleMaximize", label: "Restore Down", glyph: "" });
  });
});
