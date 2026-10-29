// The overall download speed limit offered in development, for watching
// downloads progress at a pace that's easy to follow.

export const SPEED_LIMITS = ["off", "100k", "500k", "1m", "5m"] as const;
export type SpeedLimit = (typeof SPEED_LIMITS)[number];

export const SPEED_LIMIT_LABELS: Record<SpeedLimit, string> = {
  off: "Off",
  "100k": "100 KB/s",
  "500k": "500 KB/s",
  "1m": "1 MB/s",
  "5m": "5 MB/s",
};

const BYTES_PER_SEC: Record<SpeedLimit, number | null> = {
  off: null,
  "100k": 100 * 1024,
  "500k": 500 * 1024,
  "1m": 1024 * 1024,
  "5m": 5 * 1024 * 1024,
};

/** The limit in bytes per second, or null for none. */
export function speedLimitBytes(limit: SpeedLimit): number | null {
  return BYTES_PER_SEC[limit];
}
