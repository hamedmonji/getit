// Guesses which queue a captured link belongs in, from the words in its file
// name and the title of the page it came from.

import type { QueueInfo } from "./engine";
import { baseName } from "./paths";

/** Words too common in links and page titles to say anything about a folder. */
const NOISE = new Set([
  "www", "com", "org", "net", "http", "https", "html", "htm", "php", "index",
  "download", "downloads", "file", "files", "the", "and", "for", "with", "from",
  "new", "latest", "release", "releases", "version", "official", "free",
]);

/** Lowercase words of three letters or more, without numbers and noise. */
export function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.has(w));
}

/** Whether two words are close enough: equal, or one starts the other ("ubuntu", "ubuntu2"). */
function alike(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * The queue whose folder name best matches `text`: the one sharing the most
 * words with it, the first in `queues` on a tie. Null when none share a word.
 */
export function bestQueueFor(text: string, queues: QueueInfo[]): QueueInfo | null {
  const words = new Set(wordsIn(text));
  if (!words.size) return null;
  let best: QueueInfo | null = null;
  let bestScore = 0;
  for (const queue of queues) {
    const name = wordsIn(baseName(queue.dir));
    const score = name.filter((n) => [...words].some((w) => alike(w, n))).length;
    if (score > bestScore) {
      best = queue;
      bestScore = score;
    }
  }
  return best;
}
