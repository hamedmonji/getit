// The pages in the settings sidebar.

export type SettingsPage = "general" | "appearance" | "access" | "development";

export const SETTINGS_PAGE_LABELS: Record<SettingsPage, string> = {
  general: "General",
  appearance: "Appearance",
  access: "Folder access",
  development: "Development",
};

/**
 * The pages to show, in order: General and Appearance always, Folder access
 * only where it applies, Development only in development.
 */
export function settingsPages({ access, development }: { access: boolean; development: boolean }): SettingsPage[] {
  return [
    "general",
    "appearance",
    ...(access ? ["access" as const] : []),
    ...(development ? ["development" as const] : []),
  ];
}
