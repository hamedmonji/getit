// Selecting an item by typing its name, like Finder.

/** How long after a key the next one still adds to what was typed. */
export const TYPE_SELECT_TIMEOUT_MS = 1000;

/** What's been typed so far, and when the last key came. */
export interface Typed {
  text: string;
  at: number;
}

/** `typed` with `char` added, or `char` alone if typing paused for too long. */
export function typeAhead(typed: Typed | null, char: string, now: number): Typed {
  const going = typed !== null && now - typed.at < TYPE_SELECT_TIMEOUT_MS;
  return { text: going ? typed.text + char : char, at: now };
}

/** Whether a key typed now would add to the name being typed, as a space does mid-name. */
export function isTyping(typed: Typed | null, now: number): boolean {
  return typed !== null && now - typed.at < TYPE_SELECT_TIMEOUT_MS;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The item `text` picks, as Finder does: the first name, in alphabetical order,
 * at or after what was typed, so "do" picks "Documents" and "dx" the next name
 * after it. Past the last name, the last one. Ignores case and accents. Null
 * when there are no items.
 */
export function matchByName(items: { key: string; name: string }[], text: string): string | null {
  const sorted = [...items].sort((a, b) => collator.compare(a.name, b.name));
  const match = sorted.find((item) => {
    const start = item.name.slice(0, text.length);
    return collator.compare(start, text) >= 0;
  });
  return (match ?? sorted[sorted.length - 1])?.key ?? null;
}
