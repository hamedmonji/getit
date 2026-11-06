import { describe, expect, it } from "vitest";
import {
  accessShortcuts,
  accessTop,
  addFolder,
  commonFolder,
  forgetAccess,
  goneFolders,
  relocateAccess,
  sameFolders,
  volumeOf,
} from "./access";

describe("addFolder", () => {
  it("adds a folder", () => {
    expect(addFolder(["/h/Desktop/a"], "/h/Downloads", "/h/Documents/b")).toEqual(["/h/Desktop/a", "/h/Documents/b"]);
  });

  it("leaves out a folder the root or another already covers", () => {
    expect(addFolder([], "/h/Downloads", "/h/Downloads/x")).toEqual([]);
    expect(addFolder(["/h/Desktop"], null, "/h/Desktop/x")).toEqual(["/h/Desktop"]);
    expect(addFolder(["/h/Desktop"], null, "/h/Desktop")).toEqual(["/h/Desktop"]);
  });

  it("replaces folders inside the one added", () => {
    expect(addFolder(["/h/Desktop/a", "/h/Music"], null, "/h/Desktop")).toEqual(["/h/Music", "/h/Desktop"]);
  });

  it("doesn't take a name prefix for a folder inside", () => {
    expect(addFolder(["/h/Desk"], null, "/h/Desktop")).toEqual(["/h/Desk", "/h/Desktop"]);
  });
});

describe("commonFolder", () => {
  it("finds the deepest folder holding them all", () => {
    expect(commonFolder(["/h/Documents/a", "/h/Downloads/b"])).toBe("/h");
    expect(commonFolder(["/h/Documents/a", "/h/Documents/a/b"])).toBe("/h/Documents/a");
    expect(commonFolder(["/h/Documents"])).toBe("/h/Documents");
    expect(commonFolder(["/Volumes/x", "/h/y"])).toBe("/");
  });

  it("finds it on Windows drives, which share none with each other", () => {
    expect(commonFolder(["C:\\Users\\me\\a", "C:\\Users\\me\\b\\c"])).toBe("C:\\Users\\me");
    expect(commonFolder(["C:\\Users\\me", "C:\\Data"])).toBe("C:\\");
    expect(commonFolder(["C:\\Users\\me", "D:\\Data"])).toBe("C:\\");
  });
});

describe("accessTop", () => {
  it("is home with Full Disk Access or no root", () => {
    expect(accessTop("/h", "/h/Downloads/g", ["/h/Desktop/a"], true)).toBe("/h");
    expect(accessTop("/h", null, ["/h/Desktop/a"], false)).toBe("/h");
  });

  it("is the root alone, or the folder holding it and the added ones", () => {
    expect(accessTop("/h", "/h/Downloads/g", [], false)).toBe("/h/Downloads/g");
    expect(accessTop("/h", "/h/Downloads/g", ["/h/Desktop/a"], false)).toBe("/h");
    expect(accessTop("/h", "/h/Downloads/g", ["/h/Downloads/k"], false)).toBe("/h/Downloads");
  });
});

describe("accessShortcuts", () => {
  const folders = ["/h/Documents/a", "/h/Desktop"];

  it("lists every chosen folder at the top", () => {
    expect(accessShortcuts("/h", "/h", "/h/Downloads", folders, false)).toEqual([
      "/h/Downloads",
      "/h/Documents/a",
      "/h/Desktop",
    ]);
  });

  it("leaves out the top itself", () => {
    expect(accessShortcuts("/h/Downloads", "/h", "/h/Downloads", [], false)).toEqual([]);
    expect(accessShortcuts("/h/Documents", "/h", "/h/Documents", ["/h/Documents/a"], false)).toEqual([
      "/h/Documents/a",
    ]);
  });

  it("lists nothing below the top", () => {
    expect(accessShortcuts("/h/Documents", "/h", "/h/Downloads", folders, false)).toEqual([]);
  });

  it("lists nothing with Full Disk Access or without a root", () => {
    expect(accessShortcuts("/h", "/h", "/h/Downloads", folders, true)).toEqual([]);
    expect(accessShortcuts("/h", "/h", null, folders, false)).toEqual([]);
  });
});

describe("relocateAccess", () => {
  it("follows a renamed root and moved added folders", () => {
    const moves: [string, string][] = [
      ["/h/Documents/old", "/h/Documents/new"],
      ["/h/Desktop/a", "/h/Music/a"],
    ];
    expect(relocateAccess("/h/Documents/old", ["/h/Desktop/a", "/h/Music"], moves)).toEqual({
      root: "/h/Documents/new",
      folders: ["/h/Music/a", "/h/Music"],
    });
  });

  it("keeps no root as none", () => {
    expect(relocateAccess(null, [], [["/a", "/b"]])).toEqual({ root: null, folders: [] });
  });
});

describe("forgetAccess", () => {
  it("drops removed folders and ones inside them", () => {
    expect(forgetAccess("/h/Downloads", ["/h/Desktop/a", "/h/Music/b", "/h/Music"], ["/h/Music"])).toEqual({
      root: "/h/Downloads",
      folders: ["/h/Desktop/a"],
    });
  });

  it("puts the first added folder left in place of a removed root", () => {
    const folders = ["/h/Documents/r/x", "/h/Desktop/a", "/h/Music"];
    expect(forgetAccess("/h/Documents/r", folders, ["/h/Documents/r"])).toEqual({
      root: "/h/Desktop/a",
      folders: ["/h/Music"],
    });
  });

  it("leaves no root when nothing else was chosen", () => {
    expect(forgetAccess("/h/Documents/r", [], ["/h/Documents/r"])).toEqual({ root: null, folders: [] });
  });

  it("keeps no root as none", () => {
    expect(forgetAccess(null, ["/a"], ["/a"])).toEqual({ root: null, folders: [] });
  });
});

describe("sameFolders", () => {
  it("compares folders in order", () => {
    expect(sameFolders(["/a", "/b"], ["/a", "/b"])).toBe(true);
    expect(sameFolders(["/a", "/b"], ["/b", "/a"])).toBe(false);
    expect(sameFolders(["/a"], ["/a", "/b"])).toBe(false);
  });
});

describe("volumeOf", () => {
  it("is the volume for paths on another drive, else the startup drive", () => {
    expect(volumeOf("/Volumes/Backup/a/b")).toBe("/Volumes/Backup");
    expect(volumeOf("/Volumes/Backup")).toBe("/Volumes/Backup");
    expect(volumeOf("/Users/me/Documents")).toBe("/");
    expect(volumeOf("/Volumes")).toBe("/");
  });

  it("is the drive or share on Windows", () => {
    expect(volumeOf("D:\\Movies\\a")).toBe("D:\\");
    expect(volumeOf("C:\\")).toBe("C:\\");
    expect(volumeOf("\\\\nas\\media\\x")).toBe("\\\\nas\\media\\");
  });
});

describe("goneFolders", () => {
  it("is the missing folders whose drive is there", () => {
    const existing = new Set(["/", "/h/a", "/Volumes/In"]);
    expect(goneFolders(["/h/a", "/h/b", "/Volumes/In/x", "/Volumes/Out/y"], existing)).toEqual(["/h/b", "/Volumes/In/x"]);
  });
});
