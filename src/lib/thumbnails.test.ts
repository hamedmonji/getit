import { describe, expect, it } from "vitest";
import { thumbnailPath } from "./thumbnails";

const done = { done: true, missing: false, path: "/d/clip.mp4" };

describe("thumbnailPath", () => {
  it("is the path of a finished image or video", () => {
    expect(thumbnailPath({ ...done, kind: "video" })).toBe("/d/clip.mp4");
    expect(thumbnailPath({ ...done, kind: "image", path: "/d/a.png" })).toBe("/d/a.png");
  });

  it("is null while downloading or once the file is missing", () => {
    expect(thumbnailPath({ ...done, kind: "video", done: false })).toBeNull();
    expect(thumbnailPath({ ...done, kind: "video", missing: true })).toBeNull();
  });

  it("is null for other kinds and for files without a path yet", () => {
    expect(thumbnailPath({ ...done, kind: "archive" })).toBeNull();
    expect(thumbnailPath({ ...done, kind: "image", path: null })).toBeNull();
  });
});
