import { useLayoutEffect, useState, type RefObject } from "react";
import { middleEllipsis } from "../lib/middleEllipsis";

/**
 * `text`, shortened in the middle to fit `box` without overflowing its height.
 * Tries each candidate in the box, so it wraps exactly as it'll be shown, and
 * measures again if the first measure ran before the app's fonts had loaded.
 * Assumes the box's width doesn't change.
 */
export function useMiddleEllipsis(box: RefObject<HTMLElement | null>, text: string) {
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let stale = false;
    const measure = () => {
      const fitted = middleEllipsis(text, (candidate) => {
        el.textContent = candidate;
        return el.scrollHeight <= el.clientHeight;
      });
      // React won't touch the text if `shown` doesn't change, so leave it right.
      el.textContent = fitted;
      setShown(fitted);
    };
    measure();
    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(() => {
        if (!stale) measure();
      });
    }
    return () => {
      stale = true;
    };
  }, [box, text]);
  return shown;
}
