import { useEffect, useState } from "react";

/**
 * A UI preference remembered in localStorage. Falls back to `initial` when
 * storage is unavailable or holds something not in `allowed`.
 */
export function useStoredState<T extends string>(
  key: string,
  allowed: readonly T[],
  initial: () => T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) return stored as T;
    } catch {
      // Storage unavailable; use the default.
    }
    return initial();
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not remembered this time; harmless.
    }
  }, [key, value]);

  return [value, setValue];
}
