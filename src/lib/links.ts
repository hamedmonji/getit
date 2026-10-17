/**
 * `name` without the ` (1)`, ` (2)`, ... added to keep copies apart, so copies
 * compare equal. The engine puts it before the last extension (`a.tar (1).gz`),
 * browsers before the first (`a (1).tar.gz`). Longer numbers, like years, stay.
 */
export function withoutCopyNumber(name: string): string {
  return name.replace(/ \(\d{1,3}\)((?:\.[^.\s]*)*)$/, "$1");
}

/** A URL as the engine stores it, so the same link compares equal however it was written. */
export function sameUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/** `raw` as an http(s) URL, if it is one. */
export function asLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && url.hostname ? raw : null;
  } catch {
    return null;
  }
}

/**
 * One link per line of `text`, each once, in order, for pasting a batch. A line
 * gives its first http(s) link, or is taken whole when it looks like a link
 * without a scheme (`example.com/file.zip`). Other lines are skipped.
 */
export function linksIn(text: string): string[] {
  const links: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    let link = tokens.map((t) => (/^https?:\/\//i.test(t) ? asLink(t) : null)).find(Boolean) ?? null;
    if (!link && tokens.length === 1 && /^[^/\s]+\.[a-z]{2,}(\/|$)/i.test(tokens[0])) {
      link = asLink("https://" + tokens[0]);
    }
    if (link) links.push(link);
  }
  return [...new Set(links)];
}
