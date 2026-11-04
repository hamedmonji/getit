import { describe, expect, it } from "vitest";
import { buttonLook, clickedTarget, DEFAULT_OPTIONS, MENU_CONTEXTS, menuTitle } from "./menu.js";

describe("the extension's options", () => {
  it("sends browser downloads to getit from the start", () => {
    expect(DEFAULT_OPTIONS.takeOver).toBe(true);
  });
});

describe("the right-click item", () => {
  it("shows for links, media and selections", () => {
    expect(MENU_CONTEXTS).toEqual(["link", "image", "video", "audio", "selection"]);
  });

  it("says what a click downloads", () => {
    expect(menuTitle(false)).toBe("Download with Get it");
    expect(menuTitle(true)).toBe("Download selected with Get it");
  });
});

describe("clickedTarget", () => {
  it("downloads the selection's links when there's a selection, a link inside it too", () => {
    expect(clickedTarget({ selectionText: "see https://a.com/x", linkUrl: "https://a.com/y" })).toEqual({
      selection: true,
      urls: [],
    });
  });

  it("downloads a linked image's link", () => {
    expect(clickedTarget({ linkUrl: "https://a.com/full.jpg", srcUrl: "https://a.com/thumb.jpg" })).toEqual({
      selection: false,
      urls: ["https://a.com/full.jpg"],
    });
  });

  it("downloads media that isn't linked", () => {
    expect(clickedTarget({ srcUrl: "https://a.com/v.mp4" }).urls).toEqual(["https://a.com/v.mp4"]);
  });

  it("has nothing when neither is there", () => {
    expect(clickedTarget({})).toEqual({ selection: false, urls: [] });
  });
});

describe("buttonLook", () => {
  it("offers to pause while catching, with no badge", () => {
    expect(buttonLook(true)).toMatchObject({ title: "Catching downloads for Get it. Click to pause.", badge: "" });
  });

  it("shows it's paused and offers to resume", () => {
    expect(buttonLook(false)).toMatchObject({ title: "Catching downloads is paused. Click to resume.", badge: "off" });
  });
});
