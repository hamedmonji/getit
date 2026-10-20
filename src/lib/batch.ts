// A batch of pasted or captured links waiting to be added: which are ticked,
// in what order they'll be queued, and what they add up to.

import type { LinkInfo } from "./engine";
import { formatSize } from "./format";
import { nameFromUrl } from "./viewModels";

/**
 * `order` kept in step with `urls`: links that left are dropped, new ones go
 * at the end, and the rest keep the place the user gave them.
 */
export function syncOrder(order: string[], urls: string[]): string[] {
  const kept = order.filter((url) => urls.includes(url));
  const added = urls.filter((url) => !kept.includes(url));
  return added.length || kept.length !== order.length ? [...kept, ...added] : order;
}

/** `selected` kept in step with `urls`: links that left are dropped, new ones are ticked. */
export function syncSelected(selected: Set<string>, previous: string[], urls: string[]): Set<string> {
  const next = new Set([...selected].filter((url) => urls.includes(url)));
  for (const url of urls) if (!previous.includes(url)) next.add(url);
  return next.size === selected.size && [...next].every((url) => selected.has(url)) ? selected : next;
}

/**
 * `order` with `urls` moved, in the order they're in, to before the link at
 * `index` (of `order`), or to the end.
 */
export function moveTo(order: string[], urls: string[], index: number): string[] {
  const moving = new Set(urls);
  const before = order.slice(0, index).filter((u) => !moving.has(u));
  const after = order.slice(index).filter((u) => !moving.has(u));
  return [...before, ...order.filter((u) => moving.has(u)), ...after];
}

/**
 * The rows selected after clicking `url`, as in Finder: on its own, added or
 * removed with `toggle` (Command), or the range from `anchor` with `range`
 * (Shift). The anchor is where the next range starts.
 */
export function clickSelect(
  order: string[],
  selection: Set<string>,
  anchor: string | null,
  url: string,
  { toggle, range }: { toggle: boolean; range: boolean },
): { selection: Set<string>; anchor: string | null } {
  if (range && anchor !== null && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(url)].sort((x, y) => x - y);
    return { selection: new Set(order.slice(a, b + 1)), anchor };
  }
  if (toggle) {
    const next = new Set(selection);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    return { selection: next, anchor: url };
  }
  // Pressing a selected row keeps the selection, so it can be dragged together.
  return { selection: selection.has(url) ? selection : new Set([url]), anchor: url };
}

/** The links a tick on `url` applies to: the selected rows when it's one of them, else just it. */
export function tickTargets(order: string[], selection: Set<string>, url: string): string[] {
  return selection.has(url) ? order.filter((u) => selection.has(u)) : [url];
}

/** The select-all box: ticked when all are, mixed when some are. */
export function selectAllState(order: string[], selected: Set<string>): boolean | "indeterminate" {
  const count = order.filter((url) => selected.has(url)).length;
  return count === 0 ? false : count === order.length ? true : "indeterminate";
}

/** The ticked links, in the order they'll be queued. */
export function chosen(order: string[], selected: Set<string>): string[] {
  return order.filter((url) => selected.has(url));
}

/**
 * The ticked links' total size, as far as the server has said: `infos` holds
 * its answers (null where it couldn't say, missing while it's being asked).
 */
export function totalLabel(urls: string[], infos: Record<string, LinkInfo | null>): string {
  if (!urls.length) return "Nothing selected";
  const known = urls.flatMap((url) => {
    const bytes = infos[url]?.total_bytes;
    return bytes === undefined || bytes === null ? [] : [bytes];
  });
  const fetching = urls.some((url) => infos[url] === undefined);
  if (!known.length) return fetching ? "Fetching sizes…" : "Size unknown";
  const total = formatSize(known.reduce((sum, bytes) => sum + bytes, 0));
  if (known.length === urls.length) return total;
  return fetching ? `${total} so far` : `${total} + ${urls.length - known.length} unknown`;
}

/**
 * A link's name column: the server's name, the name in the link when the
 * server couldn't say (`null`), or a placeholder while it's asked (`undefined`).
 */
export function nameCell(url: string, info: LinkInfo | null | undefined): { text: string; fetching: boolean } {
  if (info === undefined) return { text: "Fetching…", fetching: true };
  return { text: info?.file_name ?? nameFromUrl(url), fetching: false };
}

/** A link's size column: blank while it's asked, a dash when the server didn't say. */
export function sizeCell(info: LinkInfo | null | undefined): string {
  if (info === undefined) return "";
  return info?.total_bytes == null ? "—" : formatSize(info.total_bytes);
}
