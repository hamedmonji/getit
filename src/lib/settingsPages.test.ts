import { describe, expect, it } from "vitest";
import { settingsPages } from "./settingsPages";

describe("settingsPages", () => {
  it("always shows General first, then Appearance", () => {
    expect(settingsPages({ access: false, development: false })).toEqual(["general", "appearance"]);
  });

  it("adds Folder access and Development where they apply", () => {
    expect(settingsPages({ access: true, development: false })).toEqual(["general", "appearance", "access"]);
    expect(settingsPages({ access: true, development: true })).toEqual(["general", "appearance", "access", "development"]);
    expect(settingsPages({ access: false, development: true })).toEqual(["general", "appearance", "development"]);
  });
});
