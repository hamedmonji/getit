import { useRef, useState } from "react";
import { engine, type DownloadItem } from "../lib/engine";
import { plural } from "../lib/format";
import { sameUrl, withoutCopyNumber } from "../lib/links";
import { joinPath } from "../lib/paths";
import { probeLink } from "../lib/probes";
import { report } from "../lib/report";
import { displayName, nameFromUrl, queueForDir } from "../lib/viewModels";
import type { EngineState } from "./useEngine";

/** Links being added that are already downloads, waiting for the user to decide. */
export interface Duplicates {
  /** Folder the links were being added to. */
  dir: string;
  /**
   * Whether they were sent by the browser extension and have no folder yet:
   * adding them anyway hands them back to wait with the other captured links.
   */
  captured?: boolean;
  items: Duplicate[];
}

/**
 * What a link being added clashes with: a download of the same link anywhere, or
 * in the target folder a download or a file with the name it would get.
 */
export type Duplicate = (
  | { url: string; kind: "link" | "name"; existing: DownloadItem }
  | { url: string; kind: "file"; name: string }
) & {
  /** The temporary item shown for the link while it was checked, if any. */
  pendingKey?: string;
};

/** A link being added that isn't a download yet: shown while the server is asked
 * for its file name, and while the user decides about it if it's a duplicate. */
export interface PendingAdd {
  key: string;
  url: string;
  dir: string;
  /** The server's name for it, once known. */
  name: string | null;
}

interface Options {
  state: EngineState;
  cwd: string | null;
  select: (keys: string[]) => void;
  /** Goes to a folder with an item selected. */
  go: (path: string, focus: string) => void;
  setNotice: (notice: string | null) => void;
  /** Takes back captured links the user wants to add anyway, to wait for a folder. */
  recapture?: (urls: string[]) => void;
}

/** Unfinished and not running, so starting it means something. */
export const canStart = (item: DownloadItem | null) =>
  !!item && (item.status === "queued" || item.status === "paused" || item.status === "failed");

/** Adding links as downloads, checking first for ones that already exist. */
export function useAddLinks({ state, cwd, select, go, setNotice, recapture }: Options) {
  // For code that runs after waiting on the server, which needs the state as it is then.
  const stateRef = useRef(state);
  stateRef.current = state;
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null);
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  // Links already being checked or asked about, as of the last render.
  const inFlight = useRef({ duplicates, pendingAdds });
  inFlight.current = { duplicates, pendingAdds };

  /** Whether `url` is already being checked or asked about for `dir`. */
  const isInFlight = (url: string, dir: string) => {
    const key = sameUrl(url);
    const { duplicates, pendingAdds } = inFlight.current;
    return (
      (duplicates?.dir === dir && duplicates.items.some((d) => sameUrl(d.url) === key)) ||
      pendingAdds.some((p) => p.dir === dir && sameUrl(p.url) === key)
    );
  };

  /** Of several matching downloads, the one in `dir`'s queue, else an unfinished one. */
  const bestMatch = (matches: DownloadItem[], dir: string) => {
    const here = queueForDir(stateRef.current, dir)?.id;
    return matches.find((d) => d.queue_id === here) ?? matches.find((d) => d.status !== "completed") ?? matches[0];
  };

  /** A download of the same link, finished or not, in any queue. Answered from memory. */
  const findByLink = (url: string, dir: string): Duplicate | undefined => {
    const key = sameUrl(url);
    const existing = bestMatch(
      Object.values(stateRef.current.downloads).filter((d) => sameUrl(d.url) === key),
      dir,
    );
    return existing && { url, kind: "link", existing };
  };

  /**
   * A download with the same file name in any queue (signed links differ each
   * time for the same file), ignoring copy numbers; else a file or partial
   * download with that name in `dir`.
   */
  const findByName = async (url: string, name: string, dir: string): Promise<Duplicate | undefined> => {
    const base = withoutCopyNumber(name);
    const existing = bestMatch(
      Object.values(stateRef.current.downloads).filter((d) => withoutCopyNumber(displayName(d)) === base),
      dir,
    );
    if (existing) return { url, kind: "name", existing };
    if (await engine.fileExists(dir, name).catch(() => false)) return { url, kind: "file", name };
    return undefined;
  };

  /** Adds the links' downloads to `dir`, selecting them; rejects with how many failed, if any did. */
  const addNow = async (urls: string[], dir: string) => {
    const ids: string[] = [];
    const failed: unknown[] = [];
    for (const url of urls) {
      try {
        ids.push(await engine.addDownload(dir, url));
      } catch (e) {
        failed.push(e);
      }
    }
    if (ids.length) select(ids);
    if (failed.length === 1 && urls.length === 1) throw failed[0];
    if (failed.length) throw `${plural(failed.length, "link")} of ${urls.length} couldn't be added: ${failed[0]}`;
  };

  /** Asks about these duplicates too, alongside any already being asked about for `dir`. */
  const askAbout = (dir: string, items: Duplicate[], captured = false) =>
    setDuplicates((prev) =>
      prev && prev.dir === dir && !!prev.captured === captured
        ? { ...prev, items: [...prev.items, ...items] }
        : { dir, items, ...(captured && { captured }) },
    );

  /** Drops the temporary items of duplicates that have been dealt with. */
  const dropPending = (items: Duplicate[]) => {
    const keys = new Set(items.map((d) => d.pendingKey));
    setPendingAdds((list) => list.filter((p) => !keys.has(p.key)));
  };

  /**
   * Adds links to `dir`, unless they already exist; then the user is asked.
   * Links already in the list are found at once. The rest show as temporary
   * items while the server is asked for their file names, which are checked
   * against other downloads and the files in `dir`; each becomes a download, or
   * stays until the user decides. Links already being checked or asked about
   * are left to that. `again` adds them all without checking.
   * Rejects with how many failed to add, if any did.
   */
  const addLinks = async (allUrls: string[], dir = cwd, again = false) => {
    if (!dir) return;
    if (again) return addNow(allUrls, dir);
    const urls = allUrls.filter((url) => !isInFlight(url, dir));

    const byLink = urls.flatMap((url) => findByLink(url, dir) ?? []);
    if (byLink.length) askAbout(dir, byLink);
    const rest = urls.filter((url) => !byLink.some((d) => d.url === url));
    if (!rest.length) return;

    const pending: PendingAdd[] = rest.map((url) => ({ key: `pending:${crypto.randomUUID()}`, url, dir, name: null }));
    setPendingAdds((list) => [...list, ...pending]);
    const checked = await Promise.all(
      pending.map(async (p) => {
        // The name in the link stands in when the server can't be asked.
        const name = await probeLink(p.url)
          .then((info) => info.file_name)
          .catch(() => nameFromUrl(p.url));
        const duplicate = await findByName(p.url, name, dir);
        return { p, name, duplicate: duplicate && { ...duplicate, pendingKey: p.key } };
      }),
    );

    const byName = checked.flatMap((c) => c.duplicate ?? []);
    if (byName.length) {
      const names = new Map(checked.map((c) => [c.p.key, c.name]));
      setPendingAdds((list) => list.map((p) => (names.has(p.key) ? { ...p, name: names.get(p.key)! } : p)));
      askAbout(dir, byName);
    }
    const fresh = checked.filter((c) => !c.duplicate).map((c) => c.p);
    if (!fresh.length) return;
    try {
      await addNow(
        fresh.map((p) => p.url),
        dir,
      );
    } finally {
      // The downloads have replaced them by now.
      const keys = new Set(fresh.map((p) => p.key));
      setPendingAdds((list) => list.filter((p) => !keys.has(p.key)));
    }
  };

  /**
   * Checks links the browser extension sent, headed for `dir`, before the user
   * picks a folder for them, and asks about those that already exist. Returns
   * the links that aren't downloads of the same link, found at once, and a
   * promise of those among them found by file name, once the server says it.
   * Links already being asked about are left to that.
   */
  const checkCaptured = (urls: string[], dir: string) => {
    const unasked = urls.filter((url) => !isInFlight(url, dir));
    const byLink = unasked.flatMap((url) => findByLink(url, dir) ?? []);
    if (byLink.length) askAbout(dir, byLink, true);
    const fresh = unasked.filter((url) => !byLink.some((d) => d.url === url));
    const byName = Promise.all(
      fresh.map(async (url) => {
        const name = await probeLink(url)
          .then((info) => info.file_name)
          .catch(() => nameFromUrl(url));
        return findByName(url, name, dir);
      }),
    ).then((found) => {
      const duplicates = found.flatMap((d) => d ?? []);
      if (duplicates.length) askAbout(dir, duplicates, true);
      return duplicates.map((d) => d.url);
    });
    return { fresh, byName };
  };

  /** A duplicate's existing download as it is now; null for a file. */
  const currentOf = (d: Duplicate): DownloadItem | null =>
    d.kind === "file" ? null : (state.downloads[d.existing.id] ?? d.existing);

  // Goes to a duplicate's existing download with it selected, or shows its file in Finder.
  const showDuplicate = (dir: string, d: Duplicate) => {
    const item = currentOf(d);
    if (d.kind === "file" || !item) {
      if (d.kind === "file") report(engine.reveal([joinPath(dir, d.name)]));
      return;
    }
    const where = state.queues[item.queue_id]?.dir;
    if (where) go(where, item.id);
  };

  // Starts the existing downloads that aren't finished, then shows the first
  // download; with only files, shows them all in Finder.
  const startExisting = (dir: string, items: Duplicate[]) => {
    for (const d of items) {
      const item = currentOf(d);
      if (item && canStart(item)) report(engine.resume(item.id));
    }
    const first = items.find((d) => d.kind !== "file");
    if (first) showDuplicate(dir, first);
    else report(engine.reveal(items.flatMap((d) => (d.kind === "file" ? [joinPath(dir, d.name)] : []))));
  };

  /**
   * Deals with some of the duplicates being asked about: starts (or shows) their
   * existing downloads, adds them again, or skips them. The panel stays for the rest.
   */
  const settleDuplicates = (handled: Duplicate[], how: "start" | "add" | "skip") => {
    if (!duplicates) return;
    const { dir, captured } = duplicates;
    const urls = new Set(handled.map((d) => d.url));
    setDuplicates((prev) => {
      const rest = prev?.items.filter((d) => !urls.has(d.url)) ?? [];
      return prev && rest.length ? { ...prev, items: rest } : null;
    });
    if (how === "start") startExisting(dir, handled);
    if (how === "add" && captured) {
      recapture?.([...urls]);
    } else if (how === "add") {
      addLinks([...urls], dir, true)
        .catch((e) => setNotice(`Couldn't add: ${e}`))
        .finally(() => dropPending(handled));
    } else {
      dropPending(handled);
    }
  };

  return { duplicates, pendingAdds, addLinks, checkCaptured, settleDuplicates, currentOf, showDuplicate };
}
