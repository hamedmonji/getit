import { describe, expect, it } from "vitest";
import { accessMap, finderSize, LOOP_TICKS, sameFoldersFrame } from "./onboarding";

const newRow = (tick: number) => sameFoldersFrame(tick).rows[3];
const newTile = (tick: number) => sameFoldersFrame(tick).tiles[2];

describe("finderSize", () => {
  it("writes sizes as Finder does", () => {
    expect(finderSize(0)).toBe("Zero KB");
    expect(finderSize(0.28)).toBe("280 MB");
    expect(finderSize(1.4)).toBe("1.4 GB");
  });
});

describe("sameFoldersFrame", () => {
  it("starts with two finished files in each window and nothing new", () => {
    const frame = sameFoldersFrame(0);
    expect(frame.rows.filter((r) => r.shown).map((r) => r.name)).toEqual([
      "Movies",
      "cosmos_s01e01.mkv",
      "cosmos_s01e02.mkv",
      "Installers",
      "Papers",
      "Music",
    ]);
    expect(frame.tiles.filter((t) => t.shown)).toHaveLength(2);
    expect(frame.menuOpen).toBe(false);
    expect(frame.pointer).toBeNull();
  });

  it("opens the menu, then highlights Paste Link", () => {
    expect(sameFoldersFrame(4).menuOpen).toBe(true);
    expect(sameFoldersFrame(4).pasteHot).toBe(false);
    expect(sameFoldersFrame(7).pasteHot).toBe(true);
    expect(sameFoldersFrame(10).menuOpen).toBe(false);
  });

  it("downloads under the partial name, growing in Finder", () => {
    expect(newRow(10)).toMatchObject({ name: "cosmos_s01e03.mkv.part", partial: true, size: "Zero KB", shown: true });
    expect(newRow(12).size).toBe("560 MB");
    expect(newTile(12)).toMatchObject({ shown: true, progress: 40, status: "40% · 1.4 GB/s" });
    expect(sameFoldersFrame(12).downloading).toBe(true);
  });

  it("renames to the file and highlights both windows when done", () => {
    expect(newRow(15)).toMatchObject({ name: "cosmos_s01e03.mkv", partial: false, size: "1.4 GB", highlighted: true });
    expect(newTile(15)).toMatchObject({ status: "Done", progress: null, highlighted: true });
    expect(sameFoldersFrame(15).flash).toBe(true);
    expect(sameFoldersFrame(20).flash).toBe(false);
  });

  it("stripes only the rows shown", () => {
    expect(sameFoldersFrame(0).rows.map((r) => r.striped)).toEqual([false, true, false, false, true, false, true]);
    expect(sameFoldersFrame(10).rows.map((r) => r.striped)).toEqual([false, true, false, true, false, true, false]);
  });

  it("loops", () => {
    expect(sameFoldersFrame(LOOP_TICKS + 12)).toEqual(sameFoldersFrame(12));
  });

  it("holds the finished state, without highlights or pointer, when still", () => {
    const frame = sameFoldersFrame(3, true);
    expect(newRow(20)).toEqual(frame.rows[3]);
    expect(frame.rows[3]).toMatchObject({ name: "cosmos_s01e03.mkv", shown: true, highlighted: false });
    expect(frame.tiles[2]).toMatchObject({ shown: true, highlighted: false });
    expect(frame.pointer).toBeNull();
    expect(frame.menuOpen).toBe(false);
  });
});

describe("accessMap", () => {
  const reachable = (rows: { name: string; reachable: boolean }[]) => rows.filter((r) => r.reachable).map((r) => r.name);

  it("reaches every folder with Full Disk Access", () => {
    const { rows, sidebar } = accessMap("full");
    expect(rows.every((r) => r.reachable)).toBe(true);
    expect(sidebar.every((s) => s.kind === "header" || s.reachable)).toBe(true);
  });

  it("reaches only Downloads and its folders with one folder", () => {
    const { rows, sidebar } = accessMap("folder");
    expect(reachable(rows)).toEqual(["Downloads", "Movies", "ISOs", "Papers"]);
    expect(reachable(sidebar.flatMap((s) => (s.kind === "item" ? [{ name: s.label, reachable: s.reachable }] : [])))).toEqual([
      "Downloads",
    ]);
  });

  it("staggers the rows down the list", () => {
    expect(accessMap("full").rows.map((r) => r.delayMs).slice(0, 3)).toEqual([0, 40, 80]);
  });
});
