import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/**
 * A value remembered in localStorage as JSON. `parse` reads it back from what's
 * stored (null when nothing is, or storage is unavailable) and must cope with
 * anything there.
 */
export function useStoredJson<T>(key: string, parse: (raw: string | null) => T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not remembered this time; harmless.
    }
  }, [key, value]);

  return [value, setValue];
}
