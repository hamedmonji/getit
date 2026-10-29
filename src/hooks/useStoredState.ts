import { useEffect, useState } from "react";

/**
 * A UI preference remembered in localStorage. Falls back to `initial` when
 * storage is unavailable or holds something not in `allowed`, a list of
 * values or a test for them.
 */
export function useStoredState<T extends string>(
  key: string,
  allowed: readonly T[] | ((value: string) => value is T),
  initial: () => T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      const ok = typeof allowed === "function" ? allowed : (v: string) => (allowed as readonly string[]).includes(v);
      if (stored && ok(stored)) return stored as T;
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
