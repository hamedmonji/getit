import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESET_IDS,
  accentColor,
  accentOptions,
  accentTokens,
  backgroundColor,
  backgroundOptions,
  backgroundTokens,
  hexToOklch,
  isAccent,
  isBackground,
  parseAccent,
  parseBackground,
  resolveTheme, floodColor } from "./appearance";

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

describe("backgrounds", () => {
  it("reads stored backgrounds back", () => {
    expect(parseBackground("default")).toBe("default");
    expect(parseBackground("green")).toBe("green");
    expect(parseBackground("#AABBCC")).toBe("#aabbcc");
    expect(parseBackground("nope")).toBeNull();
    expect(isBackground("default")).toBe(true);
    expect(isBackground("#AABBCC")).toBe(false);
  });

  it("keeps the design's own greys by default", () => {
    expect(backgroundTokens("default", "Light")).toEqual({ "--bg": "#efeee9", "--panel": "#fbfbf9", "--panel2": "#f4f3ef" });
    expect(backgroundTokens("default", "Dark")["--panel"]).toBe("#1b1b19");
  });

  it("tints a preset faintly in its hue, at the theme's lightness", () => {
    expect(backgroundTokens("green", "Light")).toEqual({
      "--bg": "oklch(0.935 0.016 150)",
      "--panel": "oklch(0.985 0.016 150)",
      "--panel2": "oklch(0.962 0.016 150)",
    });
    expect(backgroundTokens("green", "Dark")["--panel"]).toBe("oklch(0.205 0.016 150)");
    expect(backgroundTokens("graphite", "Light")["--bg"]).toBe("oklch(0.935 0 0)");
  });

  it("takes only a custom colour's hue, toned down", () => {
    const tokens = backgroundTokens("#ff0000", "Dark");
    const [, l, c, h] = tokens["--panel"].match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!.map(Number);
    expect(l).toBe(0.205);
    expect(c).toBeLessThanOrEqual(0.032);
    expect(h).toBeCloseTo(29, 0);
    expect(backgroundTokens("#808080", "Light")["--bg"]).toBe("oklch(0.935 0 0)");
  });

  it("shows a swatch in the background's hue, strong enough to tell apart", () => {
    expect(backgroundColor("default")).toBe("#efeee9");
    expect(backgroundColor("blue")).toBe("oklch(0.78 0.08 235)");
    expect(backgroundColor("graphite")).toBe("oklch(0.78 0 0)");
    expect(backgroundColor("#123456")).toBe("#123456");
  });
});

describe("swatch options", () => {
  it("lists every accent in the theme's colour, and the backgrounds after the default", () => {
    expect(accentOptions("Dark").map((o) => o.id)).toEqual(ACCENT_PRESET_IDS);
    expect(accentOptions("Dark")[0].color).toBe(accentColor("blue", "Dark"));
    const backgrounds = backgroundOptions("Neutral");
    expect(backgrounds[0]).toEqual({ id: "default", label: "Neutral", color: backgroundColor("default") });
    expect(backgrounds).toHaveLength(ACCENT_PRESET_IDS.length + 1);
  });
});

describe("floodColor", () => {
  it("keeps a dark preset as its light tuning", () => {
    expect(floodColor("blue")).toBe("oklch(0.56 0.15 235)");
  });

  it("darkens a light preset enough for white text", () => {
    expect(floodColor("yellow")).toBe("oklch(0.56 0.15 85)");
  });

  it("uses a custom colour as it is", () => {
    expect(floodColor("#336699")).toBe("#336699");
  });
});
