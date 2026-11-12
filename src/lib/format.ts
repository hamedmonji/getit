const MB = 1024 * 1024;

export function formatSize(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
  if (mb >= 10) return Math.round(mb) + " MB";
  if (mb >= 0.1 || bytes === 0) return mb.toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export function formatSpeed(bytesPerSec: number): string {
  const mb = bytesPerSec / MB;
  return mb >= 1 ? mb.toFixed(1) + " MB/s" : Math.round(bytesPerSec / 1024) + " KB/s";
}

export function formatEta(sec: number): string {
  if (!isFinite(sec)) return "—";
  if (sec >= 3600) return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
  if (sec >= 60) return Math.floor(sec / 60) + "m " + Math.floor(sec % 60) + "s";
  return Math.max(1, Math.floor(sec)) + "s";
}

export function plural(n: number, word: string): string {
  return n + " " + word + (n === 1 ? "" : "s");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight at the start of `ms`'s day, in local time. */
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/**
 * When something was added, as Finder shows it: "Today at 3:04 PM",
 * "Yesterday at 9:15 AM", or "12 Nov 2026 at 3:04 PM". "—" when unknown (0).
 */
export function formatAdded(ms: number, now: number, locale?: string): string {
  if (!ms) return "—";
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(ms);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(ms);
  return `${date} at ${time}`;
}
