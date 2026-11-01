import { describe, expect, it } from "vitest";
import { item, queue, stateOf } from "../test/fixtures";
import {
  DEFAULT_VIEWS,
  addExts,
  addSource,
  downloadHosts,
  extOf,
  extSuggestions,
  hostOf,
  isSite,
  layoutHint,
  matchesView,
  newView,
  normalizeSite,
  parseExts,
  parseViews,
  removeExt,
  removeSource,
  removeView,
  restoreView,
  searchFiles,
  siteBadge,
  siteOptions,
  toggleKind,
  toggleSubdomains,
  typesHint,
  updateView,
  viewContents,
  viewCrumbs,
  viewFolderVm,
  viewItems,
  viewName,
  type View,
} from "./views";

const view = (patch: Partial<View> = {}): View => ({ ...newView("v"), ...patch });

describe("parseViews", () => {
  it("gives the defaults when nothing is stored or it can't be read", () => {
    expect(parseViews(null)).toBe(DEFAULT_VIEWS);
    expect(parseViews("not json")).toBe(DEFAULT_VIEWS);
    expect(parseViews("{}")).toBe(DEFAULT_VIEWS);
  });

  it("keeps an empty list, so deleting every view sticks", () => {
    expect(parseViews("[]")).toEqual([]);
  });

  it("reads views back, dropping what it doesn't know", () => {
    const raw = JSON.stringify([
      { id: "a", name: "A", kinds: ["video", "nope"], exts: ["mkv", 3], sources: [{ domain: "x.com", sub: 1 }, {}], status: "done", layout: "flat" },
      { id: "b", name: "B", status: "weird", layout: "weird" },
      { name: "no id" },
    ]);
    expect(parseViews(raw)).toEqual([
      { id: "a", name: "A", kinds: ["video"], exts: ["mkv"], sources: [{ domain: "x.com", sub: true }], status: "done", layout: "flat" },
      { id: "b", name: "B", kinds: [], exts: [], sources: [], status: "any", layout: "grouped" },
    ]);
  });
});

describe("hostOf and extOf", () => {
  it("gives a link's host without www", () => {
    expect(hostOf("https://www.Example.com/a.zip")).toBe("example.com");
    expect(hostOf("https://cdn.example.com/a.zip")).toBe("cdn.example.com");
    expect(hostOf("nonsense")).toBe("");
  });

  it("gives a name's extension in lowercase", () => {
    expect(extOf("Movie.MKV")).toBe("mkv");
    expect(extOf("archive.tar.gz")).toBe("gz");
    expect(extOf(".hidden")).toBe("");
    expect(extOf("README")).toBe("");
  });
});

describe("matchesView", () => {
  const mkv = item({ id: "m", queue_id: "q", file_name: "show.mkv", url: "https://cdn.courses.dev/show.mkv" });
  const srt = item({ id: "s", queue_id: "q", file_name: "show.srt", url: "https://courses.dev/show.srt", status: "completed" });
  const zip = item({ id: "z", queue_id: "q", status: "downloading" });

  it("matches everything with no filters", () => {
    expect([mkv, srt, zip].every((i) => matchesView(view(), i))).toBe(true);
  });

  it("matches a kind or an extension", () => {
    const v = view({ kinds: ["video"], exts: ["srt"] });
    expect(matchesView(v, mkv)).toBe(true);
    expect(matchesView(v, srt)).toBe(true);
    expect(matchesView(v, zip)).toBe(false);
  });

  it("matches a site exactly, or with its subdomains", () => {
    expect(matchesView(view({ sources: [{ domain: "courses.dev", sub: false }] }), mkv)).toBe(false);
    expect(matchesView(view({ sources: [{ domain: "courses.dev", sub: false }] }), srt)).toBe(true);
    expect(matchesView(view({ sources: [{ domain: "courses.dev", sub: true }] }), mkv)).toBe(true);
  });

  it("matches how far along a download is", () => {
    expect(matchesView(view({ status: "progress" }), zip)).toBe(true);
    expect(matchesView(view({ status: "progress" }), mkv)).toBe(false);
    expect(matchesView(view({ status: "active" }), mkv)).toBe(true);
    expect(matchesView(view({ status: "active" }), srt)).toBe(false);
    expect(matchesView(view({ status: "done" }), srt)).toBe(true);
    expect(matchesView(view({ status: "done" }), zip)).toBe(false);
  });
});

describe("view contents", () => {
  const state = stateOf(
    [queue({ id: "q2", dir: "/home/Movies" }), queue({ id: "q1", dir: "/home/Books" })],
    [
      item({ id: "a", queue_id: "q2", file_name: "a.mkv", status: "downloading", downloaded: 50 }),
      item({ id: "b", queue_id: "q2", file_name: "b.zip", status: "completed", downloaded: 100 }),
      item({ id: "c", queue_id: "q1", file_name: "c.pdf" }),
    ],
  );

  it("lists matching downloads, queues by folder", () => {
    expect(viewItems(state, view()).map((x) => x.item.id)).toEqual(["c", "a", "b"]);
    expect(viewItems(state, view({ kinds: ["video"] })).length).toBe(1);
  });

  it("shows a flat view's downloads with their folder", () => {
    const { folders, files } = viewContents(state, view({ layout: "flat", kinds: ["video", "doc"] }), null, "List");
    expect(folders).toEqual([]);
    expect(files.map((f) => f.id)).toEqual(["c", "a"]);
    expect(files[0].status).toMatch(/^Books · /);
  });

  it("shows a folder for each place a grouped view's downloads are in, then one folder's", () => {
    const grouped = view({ layout: "grouped" });
    const top = viewContents(state, grouped, null, "List");
    expect(top.files).toEqual([]);
    expect(top.folders.map((f) => [f.name, f.sub])).toEqual([
      ["Books", "1 download"],
      ["Movies", "1 downloading"],
    ]);
    const inside = viewContents(state, grouped, "/home/Movies", "List");
    expect(inside.folders).toEqual([]);
    expect(inside.files.map((f) => f.id)).toEqual(["a", "b"]);
    expect(inside.files[1].status).not.toMatch(/·.*Movies/);
  });

  it("gives a folder the progress of its unfinished matching downloads", () => {
    const vm = viewFolderVm(state, "/home/Movies", [state.downloads.a, state.downloads.b]);
    expect(vm.pct).toBe(50);
    expect(vm.showBar).toBe(true);
    expect(vm.sizeLabel).not.toBe("—");
  });
});

describe("editing views", () => {
  const views = [view({ id: "a" }), view({ id: "b" })];

  it("changes and removes one view", () => {
    expect(updateView(views, "b", { name: "B" }).map((v) => v.name)).toEqual(["New view", "B"]);
    expect(updateView(views, "a", (v) => ({ name: v.id + "!" }))[0].name).toBe("a!");
    expect(removeView(views, "a").map((v) => v.id)).toEqual(["b"]);
  });

  it("names a blank view the default", () => {
    expect(viewName("  Shows ")).toBe("Shows");
    expect(viewName("   ")).toBe("New view");
  });

  it("toggles kinds", () => {
    expect(toggleKind(view(), "video")).toEqual({ kinds: ["video"] });
    expect(toggleKind(view({ kinds: ["video", "audio"] }), "video")).toEqual({ kinds: ["audio"] });
  });

  it("reads extensions from typed text", () => {
    expect(parseExts("mkv, .SRT *.mp4  bad!ext")).toEqual(["mkv", "srt", "mp4"]);
    expect(addExts(view({ exts: ["mkv"] }), ["mkv", "srt"])).toEqual({ exts: ["mkv", "srt"] });
    expect(removeExt(view({ exts: ["mkv", "srt"] }), "mkv")).toEqual({ exts: ["srt"] });
  });

  it("normalizes and checks typed sites", () => {
    expect(normalizeSite(" https://www.Example.com/path?q ")).toBe("example.com");
    expect(normalizeSite("*.cdn.io")).toBe("cdn.io");
    expect(isSite("example.com")).toBe(true);
    expect(isSite("example")).toBe(false);
  });

  it("adds a site once; one no download came from includes its subdomains", () => {
    const hosts = ["cdn.example.com"];
    expect(addSource(view(), "cdn.example.com", hosts)).toEqual({ sources: [{ domain: "cdn.example.com", sub: false }] });
    expect(addSource(view(), "example.com", hosts)).toEqual({ sources: [{ domain: "example.com", sub: true }] });
    expect(addSource(view({ sources: [{ domain: "example.com", sub: true }] }), "example.com", hosts)).toEqual({});
    expect(addSource(view(), "nope", hosts)).toEqual({});
  });

  it("toggles subdomains and removes sites", () => {
    const v = view({ sources: [{ domain: "a.com", sub: false }, { domain: "b.com", sub: true }] });
    expect(toggleSubdomains(v, "a.com").sources).toEqual([{ domain: "a.com", sub: true }, { domain: "b.com", sub: true }]);
    expect(removeSource(v, "a.com").sources).toEqual([{ domain: "b.com", sub: true }]);
  });
});

describe("site and type suggestions", () => {
  const items = [
    item({ id: "a", queue_id: "q", file_name: "a.mkv", url: "https://cdn.example.com/a.mkv" }),
    item({ id: "b", queue_id: "q", file_name: "b.MKV", url: "https://www.other.org/b.mkv" }),
    item({ id: "c", queue_id: "q", file_name: "c.pdf", url: "https://other.org/c.pdf" }),
  ];

  it("lists download hosts once", () => {
    expect(downloadHosts(items)).toEqual(["cdn.example.com", "other.org"]);
  });

  it("offers hosts and their parent domains that contain what's typed", () => {
    const hosts = downloadHosts(items);
    expect(siteOptions(view(), hosts, "").map((o) => o.value)).toEqual(["cdn.example.com", "example.com", "other.org"]);
    expect(siteOptions(view({ sources: [{ domain: "other.org", sub: false }] }), hosts, "org")).toEqual([]);
    expect(siteOptions(view(), hosts, "example").map((o) => o.value)).toEqual(["cdn.example.com", "example.com"]);
  });

  it("offers a new valid site first, to add as typed", () => {
    expect(siteOptions(view(), [], "https://new.io/x")).toEqual([{ value: "new.io", label: "Add “new.io”" }]);
  });

  it("suggests extensions not yet listed", () => {
    expect(extSuggestions(view({ exts: ["pdf"] }), items)).toEqual(["mkv"]);
  });
});

describe("labels", () => {
  it("says what a view's types match", () => {
    expect(typesHint(view())).toMatch(/^Any type/);
    expect(typesHint(view({ kinds: ["video"], exts: ["srt"] }))).toBe("Matches video files, .srt.");
  });

  it("explains each layout", () => {
    expect(layoutHint("flat")).toMatch(/one grid/);
    expect(layoutHint("grouped")).toMatch(/A folder for each place/);
  });

  it("gives a site a stable badge", () => {
    expect(siteBadge("example.com")).toEqual(siteBadge("example.com"));
    expect(siteBadge("example.com").letter).toBe("E");
  });

  it("gives the address bar Views, the view and the folder open in it", () => {
    const v = view({ id: "x", name: "Shows" });
    expect(viewCrumbs(v, null).map((c) => c.label)).toEqual(["Views", "Shows"]);
    expect(viewCrumbs(v, "/home/TV").map((c) => c.label)).toEqual(["Views", "Shows", "TV"]);
    expect(viewCrumbs(v, null).every((c) => !c.drop)).toBe(true);
  });
});

describe("searchFiles", () => {
  it("keeps downloads whose names hold every word", () => {
    const state = stateOf([queue({ id: "q", dir: "/d" })], [
      item({ id: "a", queue_id: "q", file_name: "Lupin.S03E04.mkv" }),
      item({ id: "b", queue_id: "q", file_name: "poster.jpg" }),
    ]);
    const { files } = viewContents(state, view({ layout: "flat" }), null, "List");
    expect(searchFiles(files, "lupin s03").map((f) => f.id)).toEqual(["a"]);
    expect(searchFiles(files, "  ").length).toBe(2);
  });
});

describe("restoreView", () => {
  it("puts a deleted view back where it was, once", () => {
    const a = view({ id: "a" });
    const b = view({ id: "b" });
    expect(restoreView([b], a, 0).map((v) => v.id)).toEqual(["a", "b"]);
    expect(restoreView([a, b], a, 1).map((v) => v.id)).toEqual(["a", "b"]);
  });
});
