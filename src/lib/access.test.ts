import { describe, expect, it } from "vitest";
import { accessTop, addFolder, commonFolder } from "./access";

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
