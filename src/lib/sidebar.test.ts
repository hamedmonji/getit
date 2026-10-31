import { describe, expect, it } from "vitest";
import {
  favoriteKey,
  moveSection,
  parseSections,
  SECTIONS,
  sectionDropIndex,
  sectionOrder,
  toggleSection,
  type SectionId,
  favoriteOfKey,
  favoritePlaces,
  favoriteSlot,
  parseFavorites,
  pinFavorites,
  rootPlaces,
  slotIndex,
  toFavorites,
  unpinFavorite,
  type Favorite,
} from "./sidebar";

const folder = (path: string): Favorite => ({ path, file: false });
const paths = (favorites: Favorite[]) => favorites.map((f) => f.path);

describe("rootPlaces", () => {
  const drives = [
    { name: "Macintosh HD", path: "/" },
    { name: "USB", path: "/Volumes/USB" },
  ];

  it("shows the drives with Full Disk Access", () => {
    expect(rootPlaces(drives, "/h/Downloads", ["/h/Desktop/a"], true)).toEqual([
      { name: "Macintosh HD", path: "/", file: false },
      { name: "USB", path: "/Volumes/USB", file: false },
    ]);
  });

  it("shows the drives when no folder was chosen", () => {
    expect(paths(rootPlaces(drives, null, [], false))).toEqual(["/", "/Volumes/USB"]);
  });

  it("shows only the chosen folders without Full Disk Access", () => {
    expect(rootPlaces(drives, "/h/Downloads", ["/h/Desktop/a"], false)).toEqual([
      { name: "Downloads", path: "/h/Downloads", file: false },
      { name: "a", path: "/h/Desktop/a", file: false },
    ]);
  });
});

describe("favoritePlaces", () => {
  it("names favorites by their last part", () => {
    expect(favoritePlaces([folder("/h/Movies"), { path: "/h/a.zip", file: true }])).toEqual([
      { name: "Movies", path: "/h/Movies", file: false },
      { name: "a.zip", path: "/h/a.zip", file: true },
    ]);
  });
});

describe("slots and keys", () => {
  it("round-trips a slot's index", () => {
    expect(slotIndex(favoriteSlot(0))).toBe(0);
    expect(slotIndex(favoriteSlot(3))).toBe(3);
  });

  it("takes folder paths and odd slots for no slot", () => {
    expect(slotIndex("/h/Movies")).toBeNull();
    expect(slotIndex("favorites:x")).toBeNull();
    expect(slotIndex("favorites:-1")).toBeNull();
  });

  it("tells favorites dragged in the sidebar from items in a folder", () => {
    expect(favoriteOfKey(favoriteKey("/h/a"))).toBe("/h/a");
    expect(favoriteOfKey("/h/a")).toBeNull();
    expect(favoriteOfKey("download-id")).toBeNull();
  });
});

describe("pinFavorites", () => {
  const list = [folder("/a"), folder("/b"), folder("/c")];

  it("pins new items at the gap they're dropped in", () => {
    expect(paths(pinFavorites(list, [folder("/d")], 1))).toEqual(["/a", "/d", "/b", "/c"]);
    expect(paths(pinFavorites(list, [folder("/d"), folder("/e")], 3))).toEqual(["/a", "/b", "/c", "/d", "/e"]);
    expect(paths(pinFavorites([], [folder("/d")], 0))).toEqual(["/d"]);
  });

  it("pins at the end past the last gap", () => {
    expect(paths(pinFavorites(list, [folder("/d")], 9))).toEqual(["/a", "/b", "/c", "/d"]);
  });

  it("moves ones already pinned instead of pinning them twice", () => {
    expect(paths(pinFavorites(list, [folder("/c")], 0))).toEqual(["/c", "/a", "/b"]);
    expect(paths(pinFavorites(list, [folder("/a")], 3))).toEqual(["/b", "/c", "/a"]);
    expect(paths(pinFavorites(list, [folder("/b")], 2))).toEqual(["/a", "/b", "/c"]);
    expect(paths(pinFavorites(list, [folder("/d"), folder("/d")], 0))).toEqual(["/d", "/a", "/b", "/c"]);
  });
});

describe("unpinFavorite", () => {
  it("removes the favorite", () => {
    expect(paths(unpinFavorite([folder("/a"), folder("/b")], "/a"))).toEqual(["/b"]);
  });
});

describe("toFavorites", () => {
  const fileOf = (id: string) => (id === "done" ? "/h/done.zip" : null);

  it("pins folders, finished downloads' files and dragged favorites", () => {
    const favorites = [{ path: "/h/pinned.zip", file: true }];
    expect(toFavorites(["/h/Movies", "done", "running", favoriteKey("/h/pinned.zip")], favorites, fileOf)).toEqual([
      folder("/h/Movies"),
      { path: "/h/done.zip", file: true },
      { path: "/h/pinned.zip", file: true },
    ]);
  });
});

describe("parseFavorites", () => {
  it("reads favorites back", () => {
    const favorites = [folder("/a"), { path: "/b.zip", file: true }];
    expect(parseFavorites(JSON.stringify(favorites))).toEqual(favorites);
  });

  it("leaves out what it can't read", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("not json")).toEqual([]);
    expect(parseFavorites('{"path":"/a"}')).toEqual([]);
    expect(parseFavorites('[{"path":"/a","file":false},{"path":"rel","file":false},null,{"path":"/b"}]')).toEqual([
      folder("/a"),
    ]);
  });
});

describe("sections", () => {
  it("reads the stored order back, leaving out what it doesn't know", () => {
    expect(parseSections('["downloads","places"]')).toEqual(["downloads", "places"]);
    expect(parseSections('["downloads","downloads","other",3]')).toEqual(["downloads"]);
    expect(parseSections(null)).toEqual([]);
    expect(parseSections("not json")).toEqual([]);
    expect(parseSections('{"a":1}')).toEqual([]);
  });

  it("puts sections missing from the stored order at the end", () => {
    expect(sectionOrder([])).toEqual(["places", "favorites", "downloads"]);
    expect(sectionOrder(["downloads"])).toEqual(["downloads", "places", "favorites"]);
  });

  it("drops before the first section whose middle is below the pointer", () => {
    expect(sectionDropIndex([10, 50, 90], 0)).toBe(0);
    expect(sectionDropIndex([10, 50, 90], 30)).toBe(1);
    expect(sectionDropIndex([10, 50, 90], 100)).toBe(3);
    expect(sectionDropIndex([], 5)).toBe(0);
  });

  it("moves a section to the gap it's dropped in", () => {
    const order = [...SECTIONS];
    expect(moveSection(order, order, "downloads", 0)).toEqual(["downloads", "places", "favorites"]);
    expect(moveSection(order, order, "places", 3)).toEqual(["favorites", "downloads", "places"]);
    expect(moveSection(order, order, "places", 2)).toEqual(["favorites", "places", "downloads"]);
    // Dropped next to where it was, it stays.
    expect(moveSection(order, order, "favorites", 1)).toEqual(order);
    expect(moveSection(order, order, "favorites", 2)).toEqual(order);
  });

  it("keeps hidden sections in place", () => {
    const order: SectionId[] = ["places", "downloads", "favorites"];
    const shown: SectionId[] = ["places", "favorites"];
    expect(moveSection(order, shown, "favorites", 0)).toEqual(["favorites", "places", "downloads"]);
    expect(moveSection(order, shown, "places", 2)).toEqual(["downloads", "favorites", "places"]);
  });

  it("collapses and expands a section", () => {
    expect(toggleSection([], "favorites")).toEqual(["favorites"]);
    expect(toggleSection(["places", "favorites"], "places")).toEqual(["favorites"]);
  });
});
