import { describe, expect, it } from "vitest";
import { isFolderKey, splitKeys } from "./keys";

describe("isFolderKey", () => {
  it("tells folder paths from download ids", () => {
    expect(isFolderKey("/home/q")).toBe(true);
    expect(isFolderKey("d1")).toBe(false);
  });
});

describe("splitKeys", () => {
  it("splits keys into download ids and folder paths, keeping their order", () => {
    expect(splitKeys(["a", "/home/q/sub", "b", "/home/q/x"])).toEqual({
      ids: ["a", "b"],
      paths: ["/home/q/sub", "/home/q/x"],
    });
  });

  it("handles no keys", () => {
    expect(splitKeys([])).toEqual({ ids: [], paths: [] });
  });
});
