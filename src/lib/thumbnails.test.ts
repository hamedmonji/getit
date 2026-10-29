import { describe, expect, it } from "vitest";
import { PARTIAL_MIN_BYTES, thumbnailSource } from "./thumbnails";

const MB = 1024 * 1024;
const done = { done: true, missing: false, path: "/d/clip.mp4", size: 400 * MB, readable: 400 * MB };
const partial = { ...done, kind: "video" as const, done: false };

describe("thumbnailSource", () => {
  it("is the finished file of an image or video", () => {
    expect(thumbnailSource({ ...done, kind: "video" })).toEqual({ path: "/d/clip.mp4", available: null, key: "/d/clip.mp4" });
    expect(thumbnailSource({ ...done, kind: "image", path: "/d/a.png" })?.path).toBe("/d/a.png");
  });

  it("is the part file of a video once enough has arrived from its start", () => {
    expect(thumbnailSource({ ...partial, readable: PARTIAL_MIN_BYTES - 1 })).toBeNull();
    expect(thumbnailSource({ ...partial, readable: 100 * MB })).toEqual({
      path: "/d/clip.mp4.part",
      available: 0.25,
      key: "/d/clip.mp4.part#1",
    });
  });

  it("keeps the same key within a step, so it's made once a step", () => {
    const a = thumbnailSource({ ...partial, readable: 10 * MB });
    const b = thumbnailSource({ ...partial, readable: 90 * MB });
    const c = thumbnailSource({ ...partial, readable: 110 * MB });
    expect(a?.key).toBe(b?.key);
    expect(c?.key).not.toBe(b?.key);
  });

  it("is null for unfinished images, whose part files don't decode", () => {
    expect(thumbnailSource({ ...partial, kind: "image" })).toBeNull();
  });

  it("is null once the file is missing, without a path, without a size, or for other kinds", () => {
    expect(thumbnailSource({ ...done, kind: "video", missing: true })).toBeNull();
    expect(thumbnailSource({ ...done, kind: "image", path: null })).toBeNull();
    expect(thumbnailSource({ ...partial, size: null })).toBeNull();
    expect(thumbnailSource({ ...done, kind: "archive" })).toBeNull();
  });
});
