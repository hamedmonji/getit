// The Downloads settings, kept by getit's Rust side (src-tauri/src/prefs.rs).

export interface DownloadPrefs {
  /** The most connections one download uses; small files use fewer. */
  connections: number;
  /** Whether the Mac is kept from sleeping while a download runs. */
  keep_awake: boolean;
}

/** What getit starts with, until the saved settings are read. Matches prefs.rs. */
export const DEFAULT_DOWNLOAD_PREFS: DownloadPrefs = { connections: 16, keep_awake: true };

/** The fewest and most connections a download may use. The most matches MAX_CONNECTIONS in the engine. */
export const MIN_CONNECTIONS = 1;
export const MAX_CONNECTIONS = 32;

/** `n` brought within the connections allowed. */
export function clampConnections(n: number): number {
  return Math.min(MAX_CONNECTIONS, Math.max(MIN_CONNECTIONS, Math.round(n)));
}

/** The connections one step up or down from `n`. */
export function stepConnections(n: number, delta: number): number {
  return clampConnections(n + delta);
}

/**
 * The connections typed as `text`, brought within those allowed, or null when
 * it isn't a whole number.
 */
export function typedConnections(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  return clampConnections(Number(text));
}
