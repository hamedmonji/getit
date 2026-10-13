import { useEffect, useState } from "react";
import { engine, type DirListing } from "../lib/engine";

export interface Listing extends DirListing {
  /** File names present in the folder, for quick lookups. */
  present: Set<string>;
  error: string | null;
  /** The folder listed; null until the first listing arrives. */
  path: string | null;
}

const EMPTY: Listing = { folders: [], files: [], present: new Set(), error: null, path: null };

/**
 * Lists `path`'s subfolders and files. Re-lists whenever `refreshKey` changes
 * and when the window regains focus, so changes made outside getit show up.
 *
 * After `path` changes, the previous folder's listing is returned until the new
 * one arrives, so the view can switch folders in one step, like Finder. Check
 * the listing's `path` for which folder it describes.
 */
export function useDirListing(path: string | null, refreshKey: string): Listing {
  const [listing, setListing] = useState<Listing>(EMPTY);
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    const onFocus = () => setFocusTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    engine
      .listDir(path)
      .then((result) => {
        if (!cancelled) {
          setListing({ ...result, present: new Set(result.files), error: null, path });
        }
      })
      .catch((e) => {
        if (!cancelled) setListing({ ...EMPTY, error: String(e), path });
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey, focusTick]);

  return listing;
}
