import { describe, expect, it } from "vitest";
import { fitScale, previewContent, previewPaths, previewState } from "./appearancePreview";

const home = "/cache/Appearance Preview";

describe("fitScale", () => {
  it("scales down to fit, never up", () => {
    expect(fitScale(410, 820)).toBe(0.5);
    expect(fitScale(1000, 820)).toBe(1);
    expect(fitScale(0, 820)).toBe(1);
  });
});

describe("previewState", () => {
  it("runs a download in Downloads and one in Movies", () => {
    const state = previewState(home);
    const { downloads, movies } = previewPaths(home);
    expect(Object.values(state.queues).map((q) => q.dir)).toEqual([downloads, movies]);
    expect(Object.values(state.downloads).every((d) => d.status === "downloading")).toBe(true);
  });
});

describe("previewContent", () => {
  const listing = {
    folders: [
      { name: "Papers", items: 1 },
      { name: "Movies", items: 2 },
      { name: "Installers", items: 1 },
    ],
    visible: [{ name: "getit-setup.dmg", size: 48_000_000, modified: 0 }],
  };
  const content = previewContent(home, listing);

  it("lists the folders by name, Movies selected with its download's progress", () => {
    expect(content.folders.map((f) => f.name)).toEqual(["Installers", "Movies", "Papers"]);
    expect(content.folders.find((f) => f.name === "Movies")).toMatchObject({ showBar: true, active: 1 });
    expect(content.selected).toBe(previewPaths(home).movies);
  });

  it("shows the running download, then the files on disk", () => {
    expect(content.files.map((f) => [f.name, f.active, !!f.plain])).toEqual([
      ["ubuntu-24.04.iso", true, false],
      ["getit-setup.dmg", false, true],
    ]);
  });

  it("puts Downloads in the sidebar, its folders as favorites, and both downloads running", () => {
    expect(content.roots.map((r) => r.name)).toEqual(["Downloads"]);
    expect(content.favorites.map((f) => f.name)).toEqual(["Movies", "Installers", "Papers"]);
    expect(content.running).toHaveLength(2);
  });
});
