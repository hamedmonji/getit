import { useEffect, useState } from "react";
import { loadThumbnail } from "../lib/thumbnails";

/** An object URL for the thumbnail of the file at `path`, once made; null before then, when it has none, or with no path. */
export function useThumbnail(path: string | null): string | null {
  const [thumb, setThumb] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    loadThumbnail(path).then((url) => live && setThumb({ path, url }));
    return () => {
      live = false;
    };
  }, [path]);
  return thumb && thumb.path === path ? thumb.url : null;
}
