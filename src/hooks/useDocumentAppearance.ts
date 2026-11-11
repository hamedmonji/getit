import { useLayoutEffect } from "react";
import { accentTokens, backgroundTokens, type Accent, type Background, type Density, type ResolvedTheme, type Stripes } from "../lib/appearance";

/**
 * Gives the document how getit looks. On the document rather than the app:
 * menus and dialogs show outside it, and shadcn's components take dark mode
 * from a `dark` class above them.
 */
export function useDocumentAppearance(
  theme: ResolvedTheme,
  accent: Accent,
  background: Background,
  density: Density,
  stripes: Stripes,
) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.stripes = stripes;
    root.classList.toggle("dark", theme === "Dark");
    for (const [name, value] of Object.entries(accentTokens(accent, theme))) root.style.setProperty(name, value);
    for (const [name, value] of Object.entries(backgroundTokens(background, theme))) root.style.setProperty(name, value);
  }, [theme, accent, background, density, stripes]);
}
