const ELLIPSIS = "…";

/** `text` keeping `kept` of its `chars`, split around an ellipsis; the start gets any odd one. */
function cut(chars: string[], kept: number): string {
  const head = Math.ceil(kept / 2);
  const tail = kept - head;
  const start = chars.slice(0, head).join("").trimEnd();
  const end = chars.slice(chars.length - tail).join("").trimStart();
  return start + ELLIPSIS + end;
}

/**
 * `text` as it is if `fits` accepts it, otherwise the longest form of it with
 * the middle replaced by an ellipsis that `fits` accepts. Only the ellipsis is
 * left when nothing longer fits.
 */
export function middleEllipsis(text: string, fits: (candidate: string) => boolean): string {
  if (fits(text)) return text;
  const chars = Array.from(text);
  let best = ELLIPSIS;
  let low = 1;
  let high = chars.length - 1;
  while (low <= high) {
    const kept = Math.floor((low + high) / 2);
    const candidate = cut(chars, kept);
    if (fits(candidate)) {
      best = candidate;
      low = kept + 1;
    } else {
      high = kept - 1;
    }
  }
  return best;
}
