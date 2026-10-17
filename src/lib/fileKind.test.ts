import { describe, expect, it } from "vitest";
import { isMediaKind, resolveKind } from "./fileKind";

describe("resolveKind", () => {
  it("picks the kind from the extension, in any case", () => {
    expect(resolveKind("report.PDF")).toEqual({ kind: "doc", ext: "PDF" });
    expect(resolveKind("ubuntu.iso")).toEqual({ kind: "disc", ext: "ISO" });
    expect(resolveKind("src.zip")).toEqual({ kind: "archive", ext: "ZIP" });
    expect(resolveKind("setup.exe")).toEqual({ kind: "pkg", ext: "EXE" });
    expect(resolveKind("clip.mkv")).toEqual({ kind: "video", ext: "MKV" });
    expect(resolveKind("photo.jpeg")).toEqual({ kind: "image", ext: "JPEG" });
  });

  it("labels .tar.gz as TGZ", () => {
    expect(resolveKind("repo.tar.gz")).toEqual({ kind: "archive", ext: "TGZ" });
  });

  it("is audio when an audio extension appears anywhere in the name", () => {
    expect(resolveKind("song.mp3")).toEqual({ kind: "audio", ext: "MP3" });
    expect(resolveKind("album.flac.zip")).toEqual({ kind: "audio", ext: "ZIP" });
  });

  it("cuts labels to 4 characters", () => {
    expect(resolveKind("notes.markdown")).toEqual({ kind: "doc", ext: "MARK" });
  });

  it("falls back to a document, labelled FILE without an extension", () => {
    expect(resolveKind("data.xyz")).toEqual({ kind: "doc", ext: "XYZ" });
    expect(resolveKind("README")).toEqual({ kind: "doc", ext: "FILE" });
  });
});

describe("isMediaKind", () => {
  it("is true for video and images only", () => {
    expect(isMediaKind("video")).toBe(true);
    expect(isMediaKind("image")).toBe(true);
    expect(isMediaKind("audio")).toBe(false);
    expect(isMediaKind("doc")).toBe(false);
  });
});
