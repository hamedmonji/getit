import { describe, expect, it } from "vitest";
import { isTyping, matchByName, TYPE_SELECT_TIMEOUT_MS, typeAhead } from "./typeSelect";

describe("typeAhead", () => {
  it("adds keys typed in quick succession", () => {
    const first = typeAhead(null, "d", 0);
    expect(typeAhead(first, "o", 300)).toEqual({ text: "do", at: 300 });
  });

  it("starts over after a pause", () => {
    const first = typeAhead(null, "d", 0);
    expect(typeAhead(first, "m", TYPE_SELECT_TIMEOUT_MS)).toEqual({ text: "m", at: TYPE_SELECT_TIMEOUT_MS });
  });
});

describe("isTyping", () => {
  it("holds only until the pause", () => {
    expect(isTyping(null, 0)).toBe(false);
    expect(isTyping({ text: "a", at: 0 }, TYPE_SELECT_TIMEOUT_MS - 1)).toBe(true);
    expect(isTyping({ text: "a", at: 0 }, TYPE_SELECT_TIMEOUT_MS)).toBe(false);
  });
});

describe("matchByName", () => {
  const items = ["Music", "Documents", "downloads.zip", "Movies", "Desktop", "file 10.txt", "file 2.txt"].map(
    (name) => ({ key: `k:${name}`, name }),
  );

  it("picks the first name, alphabetically, starting with what was typed", () => {
    expect(matchByName(items, "d")).toBe("k:Desktop");
    expect(matchByName(items, "do")).toBe("k:Documents");
    expect(matchByName(items, "dow")).toBe("k:downloads.zip");
    expect(matchByName(items, "mov")).toBe("k:Movies");
  });

  it("ignores case and accents", () => {
    expect(matchByName(items, "MÚ")).toBe("k:Music");
  });

  it("orders numbers by value", () => {
    expect(matchByName(items, "file ")).toBe("k:file 2.txt");
  });

  it("picks the next name when none starts with what was typed", () => {
    expect(matchByName(items, "dx")).toBe("k:file 2.txt");
    expect(matchByName(items, "a")).toBe("k:Desktop");
  });

  it("picks the last name past the end", () => {
    expect(matchByName(items, "z")).toBe("k:Music");
  });

  it("picks nothing among no items", () => {
    expect(matchByName([], "a")).toBeNull();
  });
});
