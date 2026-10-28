import { describe, expect, it } from "vitest";
import { settingsPages } from "./settingsPages";

describe("settingsPages", () => {
  it("always shows General first", () => {
    expect(settingsPages({ access: false, development: false })).toEqual(["general"]);
  });

  it("adds Folder access and Development where they apply", () => {
    expect(settingsPages({ access: true, development: false })).toEqual(["general", "access"]);
    expect(settingsPages({ access: true, development: true })).toEqual(["general", "access", "development"]);
    expect(settingsPages({ access: false, development: true })).toEqual(["general", "development"]);
  });
});
