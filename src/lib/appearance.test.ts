import { describe, expect, it } from "vitest";
import { accentColor, accentTokens, hexToOklch, isAccent, parseAccent, resolveTheme } from "./appearance";

describe("resolveTheme", () => {
  it("keeps an explicit choice whatever the system uses", () => {
    expect(resolveTheme("Light", true)).toBe("Light");
    expect(resolveTheme("Dark", false)).toBe("Dark");
  });

  it("follows the system for System", () => {
    expect(resolveTheme("System", true)).toBe("Dark");
    expect(resolveTheme("System", false)).toBe("Light");
  });
});

describe("parseAccent", () => {
  it("accepts presets and #rrggbb, lowercased", () => {
    expect(parseAccent("green")).toBe("green");
    expect(parseAccent("#AABBCC")).toBe("#aabbcc");
  });

  it("rejects anything else", () => {
    expect(parseAccent("")).toBeNull();
    expect(parseAccent("teal")).toBeNull();
    expect(parseAccent("#abc")).toBeNull();
    expect(parseAccent("#gggggg")).toBeNull();
    expect(parseAccent("toString")).toBeNull();
  });

  it("isAccent only takes values stored as parseAccent would store them", () => {
    expect(isAccent("blue")).toBe(true);
    expect(isAccent("#a1b2c3")).toBe(true);
    expect(isAccent("#A1B2C3")).toBe(false);
  });
});

describe("hexToOklch", () => {
  it("converts known colours", () => {
    expect(hexToOklch("#ffffff")).toEqual({ l: expect.closeTo(1, 3), c: 0, h: 0 });
    expect(hexToOklch("#000000")).toEqual({ l: 0, c: 0, h: 0 });
    const red = hexToOklch("#ff0000");
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
  });
});

describe("accentTokens", () => {
  it("keeps getit's original blue and Finder's folder for the blue accent", () => {
    expect(accentTokens("blue", "Light")).toMatchObject({
      "--tint": "oklch(0.58 0.15 235)",
      "--tintSoft": "oklch(0.58 0.15 235 / 0.12)",
      "--folder-back-top": "#5dc2ec",
      "--folder-front-rim": "#3e9dc8",
      "--folder-open-shade": "rgba(0, 45, 85, 0.17)",
    });
    expect(accentTokens("blue", "Dark")).toMatchObject({
      "--tint": "oklch(0.72 0.13 235)",
      "--tintSoft": "oklch(0.72 0.13 235 / 0.16)",
      "--folder-back-top": "#5dc2ec",
    });
  });

  it("uses a custom colour as it is in both themes", () => {
    for (const theme of ["Light", "Dark"] as const) {
      expect(accentTokens("#ff8800", theme)["--tint"]).toBe("#ff8800");
      expect(accentColor("#ff8800", theme)).toBe("#ff8800");
    }
    expect(accentTokens("#ff8800", "Light")["--tintSoft"]).toBe("color-mix(in srgb, #ff8800 12%, transparent)");
  });

  it("colours folders in the accent's hue, the same in both themes", () => {
    const light = accentTokens("green", "Light");
    expect(light["--folder-back-top"]).toMatch(/^oklch\(0\.77 [\d.]+ 150\)$/);
    expect(accentTokens("green", "Dark")["--folder-back-top"]).toBe(light["--folder-back-top"]);
  });

  it("makes grey folders for graphite", () => {
    expect(accentTokens("graphite", "Light")["--folder-back-top"]).toBe("oklch(0.77 0 0)");
  });
});
