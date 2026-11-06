import { describe, expect, it } from "vitest";
import {
  baseName,
  canGoUp,
  crumbSeparator,
  crumbsFrom,
  displayPath,
  isAbsolutePath,
  isPathLike,
  folderMoves,
  isWithin,
  joinPath,
  parentPath,
  pathParts,
  relocateAll,
  relocatePath,
  resolvePath,
  rootOf,
  separatorOf,
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

describe("relocatePath", () => {
  it("follows the moved folder and anything inside it", () => {
    expect(relocatePath("/a/b", ["/a/b", "/c/b"])).toBe("/c/b");
    expect(relocatePath("/a/b/x/y", ["/a/b", "/a/renamed"])).toBe("/a/renamed/x/y");
  });

  it("leaves other paths alone, including ones that only share a prefix", () => {
    expect(relocatePath("/a/bc", ["/a/b", "/c/b"])).toBe("/a/bc");
    expect(relocatePath("/a", ["/a/b", "/c/b"])).toBe("/a");
  });
});

describe("relocateAll", () => {
  it("applies each move in turn", () => {
    expect(relocateAll("/a/b/c", [["/a/b", "/x/b"], ["/x", "/y"]])).toBe("/y/b/c");
    expect(relocateAll("/a/b", [])).toBe("/a/b");
  });
});

describe("folderMoves", () => {
  it("pairs each folder with where it lands, leaving out ones already there", () => {
    expect(folderMoves(["/a/x", "/b/y"], "/b")).toEqual([["/a/x", "/b/x"]]);
  });
});

describe("on Windows", () => {
  /** `path` with its slashes as backslashes, to write Windows paths readably. */
  const b = (path: string) => path.split("/").join("\\");
  const home = b("C:/Users/me");

  it("finds the root of drives and shares", () => {
    expect(rootOf(b("C:/Users/me"))).toBe(b("C:/"));
    expect(rootOf(b("d:/"))).toBe(b("d:/"));
    expect(rootOf(b("//nas/media/films"))).toBe(b("//nas/media/"));
    expect(rootOf("/Users/me")).toBe("/");
  });

  it("tells absolute paths apart", () => {
    expect(isAbsolutePath(b("C:/x"))).toBe(true);
    expect(isAbsolutePath("C:/x")).toBe(true);
    expect(isAbsolutePath(b("//nas/media"))).toBe(true);
    expect(isAbsolutePath("C:x")).toBe(false);
    expect(isAbsolutePath("d1")).toBe(false);
  });

  it("joins and splits with backslashes", () => {
    expect(joinPath(b("C:/Users"), "me")).toBe(b("C:/Users/me"));
    expect(joinPath(b("C:/"), "Users")).toBe(b("C:/Users"));
    expect(parentPath(b("C:/Users/me"))).toBe(b("C:/Users"));
    expect(parentPath(b("C:/Users"))).toBe(b("C:/"));
    expect(parentPath(b("C:/"))).toBe(b("C:/"));
    expect(parentPath(b("//nas/media/films"))).toBe(b("//nas/media/"));
    expect(pathParts(b("C:/Users/me"))).toEqual(["Users", "me"]);
    expect(separatorOf(b("C:/x"))).toBe(b("/"));
  });

  it("names the last part, or the drive for a root", () => {
    expect(baseName(b("C:/Users/me"))).toBe("me");
    expect(baseName(b("C:/"))).toBe("C:");
    expect(baseName(b("//nas/media/"))).toBe(b("//nas/media"));
  });

  it("tells what's inside a folder", () => {
    expect(isWithin(b("C:/Users/me/a"), home)).toBe(true);
    expect(isWithin(b("C:/Users/meg"), home)).toBe(false);
    expect(isWithin(b("C:/Users"), b("C:/"))).toBe(true);
    expect(relocatePath(b("C:/a/b/c"), [b("C:/a/b"), b("D:/b")])).toBe(b("D:/b/c"));
    expect(folderMoves([b("C:/a/x")], b("C:/b"))).toEqual([[b("C:/a/x"), b("C:/b/x")]]);
  });

  it("shows home as ~", () => {
    expect(displayPath(b("C:/Users/me/Downloads"), home)).toBe(b("~/Downloads"));
  });

  it("takes drive letters and backslashes as paths in the address bar", () => {
    expect(isPathLike(b("C:/x"))).toBe(true);
    expect(isPathLike("d:")).toBe(true);
    expect(isPathLike(b("//nas/x"))).toBe(true);
    expect(isPathLike("c++ tutorial")).toBe(false);
    expect(isPathLike("a:b")).toBe(false);
  });

  it("resolves typed paths on the home's drive", () => {
    expect(resolvePath(b("~/Downloads"), home)).toBe(b("C:/Users/me/Downloads"));
    expect(resolvePath("~/Downloads", home)).toBe(b("C:/Users/me/Downloads"));
    expect(resolvePath(b("D:/a/./b/../c/"), home)).toBe(b("D:/a/c"));
    expect(resolvePath("d:", home)).toBe(b("d:/"));
    expect(resolvePath(b("C:/../.."), home)).toBe(b("C:/"));
    expect(resolvePath("/Temp", home)).toBe(b("C:/Temp"));
    expect(resolvePath("D:/x//y", home)).toBe(b("D:/x/y"));
    expect(resolvePath(b("//nas/media/a/.."), home)).toBe(b("//nas/media/"));
  });

  it("makes breadcrumbs from home or the drive", () => {
    expect(crumbsFrom(home, b("C:/Users/me/a"))).toEqual([
      { label: "~", path: home },
      { label: "a", path: b("C:/Users/me/a") },
    ]);
    expect(crumbsFrom(home, b("D:/Movies/x"))).toEqual([
      { label: "D:", path: b("D:/") },
      { label: "Movies", path: b("D:/Movies") },
      { label: "x", path: b("D:/Movies/x") },
    ]);
  });

  it("separates breadcrumbs with the path's own separator", () => {
    expect(crumbSeparator("/")).toBe("");
    expect(crumbSeparator("/Users")).toBe("/");
    expect(crumbSeparator(b("D:/"))).toBe(b("/"));
    expect(crumbSeparator(b("D:/Movies"))).toBe(b("/"));
  });

  it("stops going up at the drive's root", () => {
    expect(canGoUp(b("D:/"), home)).toBe(false);
    expect(canGoUp(b("D:/Movies"), home)).toBe(true);
    expect(canGoUp(home, home)).toBe(false);
  });
});
