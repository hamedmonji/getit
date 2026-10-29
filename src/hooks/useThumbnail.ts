import { useEffect, useState } from "react";
import { loadThumbnail, type ThumbnailSource } from "../lib/thumbnails";

/**
 * An object URL for the thumbnail from `source`, once made. While a newer one
 * is made, as a video downloads further, the last one stays. Null before the
 * first, when there's none, or with no source.
 */
export function useThumbnail(source: ThumbnailSource | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = source?.key ?? null;
  useEffect(() => {
    if (!source) {
      setUrl(null);
      return;
    }
    let live = true;
    loadThumbnail(source).then((made) => live && made && setUrl(made));
    return () => {
      live = false;
    };
    // The source is the same while its key is.
  }, [key]);
  return url;
}
