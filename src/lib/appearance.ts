// How getit looks: the theme, accent and background colours, density and list stripes chosen in Settings.

export type ThemePreference = "Light" | "Dark" | "System";
export type ResolvedTheme = "Light" | "Dark";
export type Density = "comfortable" | "compact";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["Light", "Dark", "System"];
export const DENSITIES: readonly Density[] = ["comfortable", "compact"];
export const DENSITY_LABELS: Record<Density, string> = { comfortable: "Comfortable", compact: "Compact" };
/** Whether the list view's rows alternate background colours, like Finder's. */
export type Stripes = "on" | "off";
export const STRIPES: readonly Stripes[] = ["on", "off"];

/** A colour in OKLCh: lightness 0–1, chroma, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export type AccentPreset = "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "graphite";
/** A preset, or a custom colour as #rrggbb. */
export type Accent = AccentPreset | `#${string}`;

/** The presets, each tuned for light and dark mode. Blue is getit's original tint. */
export const ACCENT_PRESETS: Record<AccentPreset, { label: string; light: Oklch; dark: Oklch }> = {
  blue: { label: "Blue", light: { l: 0.58, c: 0.15, h: 235 }, dark: { l: 0.72, c: 0.13, h: 235 } },
  purple: { label: "Purple", light: { l: 0.56, c: 0.17, h: 300 }, dark: { l: 0.72, c: 0.14, h: 300 } },
  pink: { label: "Pink", light: { l: 0.6, c: 0.18, h: 355 }, dark: { l: 0.74, c: 0.14, h: 355 } },
  red: { label: "Red", light: { l: 0.58, c: 0.19, h: 25 }, dark: { l: 0.7, c: 0.16, h: 25 } },
  orange: { label: "Orange", light: { l: 0.66, c: 0.16, h: 55 }, dark: { l: 0.76, c: 0.14, h: 55 } },
  yellow: { label: "Yellow", light: { l: 0.72, c: 0.15, h: 85 }, dark: { l: 0.84, c: 0.14, h: 90 } },
  green: { label: "Green", light: { l: 0.6, c: 0.15, h: 150 }, dark: { l: 0.74, c: 0.14, h: 150 } },
  graphite: { label: "Graphite", light: { l: 0.5, c: 0, h: 0 }, dark: { l: 0.7, c: 0, h: 0 } },
};

export const ACCENT_PRESET_IDS = Object.keys(ACCENT_PRESETS) as AccentPreset[];

const HEX = /^#[0-9a-f]{6}$/i;

export function isPreset(accent: string): accent is AccentPreset {
  return Object.prototype.hasOwnProperty.call(ACCENT_PRESETS, accent);
}

/** A stored accent, or null when it's neither a preset nor #rrggbb. */
export function parseAccent(stored: string): Accent | null {
  if (isPreset(stored)) return stored;
  if (HEX.test(stored)) return stored.toLowerCase() as Accent;
  return null;
}

export function isAccent(value: string): value is Accent {
  return parseAccent(value) === value;
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === "System") return systemDark ? "Dark" : "Light";
  return pref;
}

/** sRGB #rrggbb to OKLCh, by way of OKLab. */
export function hexToOklch(hex: string): Oklch {
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  // Greys have no hue to speak of; keep it at 0 rather than rounding noise.
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: c < 1e-4 ? 0 : c, h };
}

const round = (n: number) => +n.toFixed(3);

export function oklchCss({ l, c, h }: Oklch, alpha?: number): string {
  const color = `${round(l)} ${round(c)} ${round(h)}`;
  return alpha === undefined ? `oklch(${color})` : `oklch(${color} / ${alpha})`;
}

/** The accent's colour in a theme: a preset's tuned one, or a custom colour as it is. */
export function accentColor(accent: Accent, theme: ResolvedTheme): string {
  return isPreset(accent) ? oklchCss(ACCENT_PRESETS[accent][theme === "Dark" ? "dark" : "light"]) : accent;
}

/** Finder's folder icon, measured from macOS, kept exactly for the blue accent. */
const FINDER_FOLDER: Record<string, string> = {
  "--folder-back-top": "#5dc2ec",
  "--folder-back-bottom": "#3aa7dc",
  "--folder-back-rim": "#8bd5f3",
  "--folder-front-top": "#73cff7",
  "--folder-front-bottom": "#47b1e2",
  "--folder-front-rim": "#3e9dc8",
  "--folder-open-shade": "rgba(0, 45, 85, 0.17)",
};

/**
 * Each part of the folder as lightness, and chroma relative to the accent's,
 * measured from Finder's blue folder against the blue accent (chroma 0.15).
 */
const FOLDER_SHADES: Record<string, { l: number; c: number }> = {
  "--folder-back-top": { l: 0.77, c: 0.74 },
  "--folder-back-bottom": { l: 0.69, c: 0.83 },
  "--folder-back-rim": { l: 0.835, c: 0.56 },
  "--folder-front-top": { l: 0.81, c: 0.7 },
  "--folder-front-bottom": { l: 0.72, c: 0.8 },
  "--folder-front-rim": { l: 0.66, c: 0.72 },
};

/** Folders in the accent's hue, at Finder's lightness, whatever the accent's own lightness. */
function folderTokens({ c, h }: Oklch): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [name, shade] of Object.entries(FOLDER_SHADES)) {
    tokens[name] = oklchCss({ l: shade.l, c: c * shade.c, h });
  }
  tokens["--folder-open-shade"] = oklchCss({ l: 0.3, c: c * 0.5, h }, 0.17);
  return tokens;
}

/** The CSS variables that colour getit in an accent, for one theme. */
export function accentTokens(accent: Accent, theme: ResolvedTheme): Record<string, string> {
  const softAlpha = theme === "Dark" ? 0.16 : 0.12;
  if (isPreset(accent)) {
    const color = ACCENT_PRESETS[accent][theme === "Dark" ? "dark" : "light"];
    return {
      "--tint": oklchCss(color),
      "--tintSoft": oklchCss(color, softAlpha),
      // Folders look the same in light and dark mode, so they follow the light tuning.
      ...(accent === "blue" ? FINDER_FOLDER : folderTokens(ACCENT_PRESETS[accent].light)),
    };
  }
  return {
    "--tint": accent,
    "--tintSoft": `color-mix(in srgb, ${accent} ${softAlpha * 100}%, transparent)`,
    ...folderTokens(hexToOklch(accent)),
  };
}

/** getit's own warm greys, a preset tinted in its hue, or a custom colour's hue as #rrggbb. */
export type Background = "default" | AccentPreset | `#${string}`;

/** The background shades for each theme: the window behind, the content, and the side panels. */
const BACKGROUND_SHADES: Record<ResolvedTheme, Record<"--bg" | "--panel" | "--panel2", number>> = {
  Light: { "--bg": 0.935, "--panel": 0.985, "--panel2": 0.962 },
  Dark: { "--bg": 0.165, "--panel": 0.205, "--panel2": 0.232 },
};

/** The design's own backgrounds, as in App.css. */
const DEFAULT_BACKGROUNDS: Record<ResolvedTheme, Record<string, string>> = {
  Light: { "--bg": "#efeee9", "--panel": "#fbfbf9", "--panel2": "#f4f3ef" },
  Dark: { "--bg": "#121211", "--panel": "#1b1b19", "--panel2": "#232320" },
};

/** How much colour a tinted background has: enough to see, little enough to read on. */
const BACKGROUND_CHROMA = 0.016;

/** A stored background, or null when it's none of the presets nor #rrggbb. */
export function parseBackground(stored: string): Background | null {
  if (stored === "default") return stored;
  const accent = parseAccent(stored);
  return accent === null ? null : (accent as Background);
}

export function isBackground(value: string): value is Background {
  return parseBackground(value) === value;
}

/**
 * The background's hue and how strongly to tint: a preset's own hue, or a
 * custom colour's, toned down so text stays readable; null for the default.
 */
function backgroundTint(background: Background): { c: number; h: number } | null {
  if (background === "default") return null;
  if (isPreset(background)) {
    const { c, h } = ACCENT_PRESETS[background].light;
    return { c: c === 0 ? 0 : BACKGROUND_CHROMA, h };
  }
  const { c, h } = hexToOklch(background);
  return { c: Math.min(c * 0.25, BACKGROUND_CHROMA * 2), h };
}

/**
 * The CSS variables that colour getit's backgrounds for one theme. Only the
 * hue of the choice is used, at the theme's own lightness, so light mode stays
 * light and dark mode dark.
 */
export function backgroundTokens(background: Background, theme: ResolvedTheme): Record<string, string> {
  const tint = backgroundTint(background);
  if (!tint) return DEFAULT_BACKGROUNDS[theme];
  const tokens: Record<string, string> = {};
  for (const [name, l] of Object.entries(BACKGROUND_SHADES[theme])) tokens[name] = oklchCss({ l, ...tint });
  return tokens;
}

/**
 * A background's colour as a swatch shows it: its hue made strong enough to
 * tell apart, since the backgrounds themselves are all near white or black;
 * a custom colour as it is, and the default as its light grey.
 */
export function backgroundColor(background: Background): string {
  if (background === "default") return DEFAULT_BACKGROUNDS.Light["--bg"];
  if (!isPreset(background)) return background;
  const tint = backgroundTint(background)!;
  return oklchCss({ l: 0.78, c: tint.c * 5, h: tint.h });
}

/** The accent presets as swatches, each in its colour for `theme`. */
export function accentOptions(theme: ResolvedTheme): { id: AccentPreset; label: string; color: string }[] {
  return ACCENT_PRESET_IDS.map((id) => ({ id, label: ACCENT_PRESETS[id].label, color: accentColor(id, theme) }));
}

/** The backgrounds as swatches, getit's own greys first, called `defaultLabel`. */
export function backgroundOptions(defaultLabel: string): { id: Background; label: string; color: string }[] {
  return (["default", ...ACCENT_PRESET_IDS] as const).map((id) => ({
    id,
    label: id === "default" ? defaultLabel : ACCENT_PRESETS[id].label,
    color: backgroundColor(id),
  }));
}

/**
 * The colour step 3's finish floods the window in: a preset's light tuning,
 * kept dark enough for white text on it, or a custom colour as it is.
 */
export function floodColor(accent: Accent): string {
  if (!isPreset(accent)) return accent;
  const { l, c, h } = ACCENT_PRESETS[accent].light;
  return oklchCss({ l: Math.min(l, 0.56), c, h });
}
