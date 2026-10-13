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
