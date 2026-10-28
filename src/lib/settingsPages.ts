// The pages in the settings sidebar.

export type SettingsPage = "general" | "access" | "development";

export const SETTINGS_PAGE_LABELS: Record<SettingsPage, string> = {
  general: "General",
  access: "Folder access",
  development: "Development",
};

/** The pages to show, in order: Folder access only where it applies, Development only in development. */
export function settingsPages({ access, development }: { access: boolean; development: boolean }): SettingsPage[] {
  return ["general", ...(access ? ["access" as const] : []), ...(development ? ["development" as const] : [])];
}
