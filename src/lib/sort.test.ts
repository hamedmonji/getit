import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, parseSortOrder, sortFiles } from "./sort";
import { pendingVm, type FileVm } from "./viewModels";

const file = (id: string, overrides: Partial<FileVm>): FileVm => ({
  ...pendingVm(id, `https://example.com/${id}`, overrides.name ?? id, ""),
  ...overrides,
});
const ids = (files: FileVm[]) => files.map((f) => f.id);

describe("sortFiles", () => {
  it("sorts by kind label, as in Finder", () => {
    const files = [file("v", { kind: "video" }), file("a", { kind: "archive" }), file("d", { kind: "doc" })];
    expect(ids(sortFiles(files, ["kind"]))).toEqual(["a", "d", "v"]);
  });

  it("sorts names naturally, ignoring case", () => {
    const files = [file("1", { name: "file10" }), file("2", { name: "File2" }), file("3", { name: "file1" })];
    expect(ids(sortFiles(files, ["name"]))).toEqual(["3", "2", "1"]);
  });

  it("sorts by size, largest first and unknown last", () => {
    const files = [file("s", { size: 1 }), file("u", { size: null }), file("l", { size: 100 })];
    expect(ids(sortFiles(files, ["size"]))).toEqual(["l", "s", "u"]);
  });

  it("sorts by date added, newest first", () => {
    const files = [file("old", { addedAt: 1 }), file("new", { addedAt: 3 }), file("mid", { addedAt: 2 })];
    expect(ids(sortFiles(files, ["added"]))).toEqual(["new", "mid", "old"]);
  });

  it("breaks ties with the next key, and keeps the order of full ties", () => {
    const files = [
      file("a", { kind: "doc", size: 1 }),
      file("b", { kind: "doc", size: 5 }),
      file("c", { kind: "archive", size: 1 }),
      file("d", { kind: "doc", size: 5 }),
    ];
    expect(ids(sortFiles(files, ["kind", "size"]))).toEqual(["c", "b", "d", "a"]);
  });

  it("leaves the input alone", () => {
    const files = [file("b", { addedAt: 1 }), file("a", { addedAt: 2 })];
    sortFiles(files, ["added"]);
    expect(ids(files)).toEqual(["b", "a"]);
  });
});

describe("parseSortOrder", () => {
  it("is null with nothing stored, or no known keys", () => {
    expect(parseSortOrder(null)).toBeNull();
    expect(parseSortOrder("")).toBeNull();
    expect(parseSortOrder("colour,weight")).toBeNull();
  });

  it("keeps the stored order and adds missing keys at the end", () => {
    expect(parseSortOrder("size,name")).toEqual(["size", "name", "kind", "added"]);
  });

  it("drops unknown and repeated keys", () => {
    expect(parseSortOrder("added,bogus,added,kind")).toEqual(["added", "kind", "name", "size"]);
  });

  it("reads a full order as stored", () => {
    expect(parseSortOrder(DEFAULT_SORT.join(","))).toEqual(DEFAULT_SORT);
  });
});
