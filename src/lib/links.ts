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
 * What the new-link field starts with when refreshing a download's expired
 * `current` link: a different link on the clipboard, likely just copied from
 * the browser, else the current link to edit.
 */
export function refreshPrefill(clipboard: string | null, current: string): string {
  const link = clipboard ? asLink(clipboard.trim()) : null;
  return link && sameUrl(link) !== sameUrl(current) ? link : current;
}

/**
 * Captured `links` split while a download waits for a new link: the first
 * becomes its link, the rest are handled as captured links usually are.
 */
export function takeForRefresh(links: string[]): { refresh: string | null; rest: string[] } {
  return { refresh: links[0] ?? null, rest: links.slice(1) };
}

/** Whether `input` can replace the link `current`: a link, and a different one. */
export function canRefresh(input: string, current: string): boolean {
  const link = asLink(input.trim());
  return !!link && link !== current;
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

/** Captured links with `urls` joined on, each once. */
export function withCaptured(captured: string[] | null, urls: string[]): string[] {
  return [...new Set([...(captured ?? []), ...urls])];
}

/** Captured links without `urls`; null when none are left. */
export function withoutCaptured(captured: string[] | null, urls: string[]): string[] | null {
  const rest = captured?.filter((url) => !urls.includes(url)) ?? [];
  return rest.length ? rest : null;
}
