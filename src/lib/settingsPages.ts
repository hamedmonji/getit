// The pages in the settings sidebar.

export type SettingsPage = "general" | "queues" | "appearance" | "access" | "development";

export const SETTINGS_PAGE_LABELS: Record<SettingsPage, string> = {
  general: "General",
  queues: "Queues",
  appearance: "Appearance",
  access: "Folder access",
  development: "Development",
};

/**
 * The pages to show, in order: General, Queues and Appearance always, Folder access
 * only where it applies, Development only in development.
 */
export function settingsPages({ access, development }: { access: boolean; development: boolean }): SettingsPage[] {
  return [
    "general",
    "queues",
    "appearance",
    ...(access ? ["access" as const] : []),
    ...(development ? ["development" as const] : []),
  ];
}
