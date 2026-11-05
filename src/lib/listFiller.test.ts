import { describe, expect, it } from "vitest";
import { fillerStripes } from "./listFiller";

describe("fillerStripes", () => {
  it("fills the room, cutting the last row off", () => {
    expect(fillerStripes(0, 100, 38)).toHaveLength(3);
    expect(fillerStripes(0, 76, 38)).toHaveLength(2);
  });

  it("carries on the alternation after the real rows", () => {
    // Real rows 1 and 3 are plain, 2 striped; the 4th, the first filler, is striped.
    expect(fillerStripes(3, 114, 38)).toEqual([true, false, true]);
    expect(fillerStripes(2, 114, 38)).toEqual([false, true, false]);
  });

  it("stripes every second row of an empty folder, from the second", () => {
    expect(fillerStripes(0, 152, 38)).toEqual([false, true, false, true]);
  });

  it("has none when there's no room", () => {
    expect(fillerStripes(5, 0, 38)).toEqual([]);
    expect(fillerStripes(5, -20, 38)).toEqual([]);
    expect(fillerStripes(5, 100, 0)).toEqual([]);
  });
});
