import { describe, expect, it } from "vitest";
import {
  baseName,
  canGoUp,
  crumbsFrom,
  displayPath,
  isPathLike,
  isWithin,
  joinPath,
  parentPath,
  resolvePath,
  splitName,
} from "./paths";

describe("joinPath", () => {
  it("joins with a single slash", () => {
    expect(joinPath("/a", "b")).toBe("/a/b");
    expect(joinPath("/a/", "b")).toBe("/a/b");
    expect(joinPath("/", "b")).toBe("/b");
  });
});

describe("parentPath", () => {
  it("drops the last part", () => {
    expect(parentPath("/a/b/c")).toBe("/a/b");
  });

  it("stops at the root", () => {
    expect(parentPath("/a")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});

describe("splitName", () => {
  it("splits at the last dot", () => {
    expect(splitName("report.pdf")).toEqual(["report", ".pdf"]);
    expect(splitName("a.b.c")).toEqual(["a.b", ".c"]);
  });

  it("keeps compound archive extensions together, in any case", () => {
    expect(splitName("repo.tar.gz")).toEqual(["repo", ".tar.gz"]);
    expect(splitName("Repo.TAR.XZ")).toEqual(["Repo", ".TAR.XZ"]);
  });

  it("treats names without a dot, and dotfiles, as all stem", () => {
    expect(splitName("README")).toEqual(["README", ""]);
    expect(splitName(".bashrc")).toEqual([".bashrc", ""]);
    expect(splitName(".tar.gz")).toEqual([".tar", ".gz"]);
  });
});

describe("isWithin", () => {
  it("is true for the folder itself and anything inside it", () => {
    expect(isWithin("/a", "/a")).toBe(true);
    expect(isWithin("/a/b/c", "/a")).toBe(true);
    expect(isWithin("/a/b", "/")).toBe(true);
  });

  it("is false for siblings that share a prefix", () => {
    expect(isWithin("/ab", "/a")).toBe(false);
    expect(isWithin("/a", "/a/b")).toBe(false);
  });
});

describe("displayPath", () => {
  it("shows home and paths under it with ~", () => {
    expect(displayPath("/Users/me", "/Users/me")).toBe("~");
    expect(displayPath("/Users/me/Downloads", "/Users/me")).toBe("~/Downloads");
  });

  it("leaves paths outside home alone", () => {
    expect(displayPath("/Volumes/x", "/Users/me")).toBe("/Volumes/x");
    expect(displayPath("/Users/meg", "/Users/me")).toBe("/Users/meg");
  });
});

describe("baseName", () => {
  it("gives the last part, or / for the root", () => {
    expect(baseName("/a/b")).toBe("b");
    expect(baseName("/")).toBe("/");
  });
});

describe("isPathLike", () => {
  it("is true for text starting with ~ or /", () => {
    expect(isPathLike("~/x")).toBe(true);
    expect(isPathLike("  /x")).toBe(true);
  });

  it("is false for search text", () => {
    expect(isPathLike("ubuntu iso")).toBe(false);
    expect(isPathLike("")).toBe(false);
  });
});

describe("resolvePath", () => {
  const home = "/Users/me";

  it("expands ~", () => {
    expect(resolvePath("~", home)).toBe("/Users/me");
    expect(resolvePath(" ~/Downloads ", home)).toBe("/Users/me/Downloads");
  });

  it("doesn't expand ~ in the middle of a name", () => {
    expect(resolvePath("~other", home)).toBe("/~other");
  });

  it("resolves . and .. and extra slashes", () => {
    expect(resolvePath("/a//b/./c/../d/", home)).toBe("/a/b/d");
    expect(resolvePath("/../..", home)).toBe("/");
  });
});

describe("crumbsFrom", () => {
  const home = "/Users/me";

  it("starts at home for paths under it", () => {
    expect(crumbsFrom(home, "/Users/me/a/b")).toEqual([
      { label: "~", path: "/Users/me" },
      { label: "a", path: "/Users/me/a" },
      { label: "b", path: "/Users/me/a/b" },
    ]);
  });

  it("is just ~ at home", () => {
    expect(crumbsFrom(home, home)).toEqual([{ label: "~", path: "/Users/me" }]);
  });

  it("starts at the root outside home", () => {
    expect(crumbsFrom(home, "/Volumes/x")).toEqual([
      { label: "/", path: "/" },
      { label: "Volumes", path: "/Volumes" },
      { label: "x", path: "/Volumes/x" },
    ]);
  });
  it("starts at the chosen root, named, for paths under it", () => {
    expect(crumbsFrom(home, "/Users/me/Documents/dl/a", "/Users/me/Documents/dl")).toEqual([
      { label: "dl", path: "/Users/me/Documents/dl" },
      { label: "a", path: "/Users/me/Documents/dl/a" },
    ]);
    expect(crumbsFrom(home, "/Volumes/x/y", "/Volumes/x")).toEqual([
      { label: "x", path: "/Volumes/x" },
      { label: "y", path: "/Volumes/x/y" },
    ]);
  });

  it("falls back to home, then the root, outside the chosen root", () => {
    expect(crumbsFrom(home, "/Users/me/Music", "/Users/me/Documents/dl")[0]).toEqual({ label: "~", path: home });
    expect(crumbsFrom(home, "/tmp", "/Users/me/Documents/dl")[0]).toEqual({ label: "/", path: "/" });
  });
});

describe("canGoUp", () => {
  const home = "/Users/me";

  it("stops at home and the file system's root", () => {
    expect(canGoUp(home, home)).toBe(false);
    expect(canGoUp("/", home)).toBe(false);
    expect(canGoUp("/Users/me/a", home)).toBe(true);
    expect(canGoUp("/Volumes", home)).toBe(true);
  });

  it("stops at the chosen root too", () => {
    const top = "/Users/me/Documents/dl";
    expect(canGoUp(top, home, top)).toBe(false);
    expect(canGoUp(`${top}/a`, home, top)).toBe(true);
    expect(canGoUp("/Users/me/Music", home, top)).toBe(true);
  });
});
