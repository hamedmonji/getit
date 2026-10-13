import { useEffect, useState } from "react";
import { engine, type DirListing } from "../lib/engine";

export interface Listing extends DirListing {
  /** File names present in the folder, for quick lookups. */
  present: Set<string>;
  error: string | null;
  /** False until the first listing of the current path has arrived. */
  loaded: boolean;
}

const EMPTY: Listing = { folders: [], files: [], present: new Set(), error: null, loaded: false };

/**
 * Lists `path`'s subfolders and files. Re-lists whenever `refreshKey` changes
 * and when the window regains focus, so changes made outside getit show up.
 */
export function useDirListing(path: string | null, refreshKey: string): Listing {
  // Tagged with its path, so a previous folder's listing is never shown for a new one.
  const [listing, setListing] = useState<{ path: string; value: Listing } | null>(null);
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
          setListing({
            path,
            value: { ...result, present: new Set(result.files), error: null, loaded: true },
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setListing({ path, value: { ...EMPTY, error: String(e), loaded: true } });
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey, focusTick]);

  return listing && listing.path === path ? listing.value : EMPTY;
}
