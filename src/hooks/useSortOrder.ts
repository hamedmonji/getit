import { useEffect, useState } from "react";
import { DEFAULT_SORT, parseSortOrder, type SortKey } from "../lib/sort";

const KEY = "getit.sortOrder";

/** The sort order setting, remembered in localStorage like the other preferences. */
export function useSortOrder(): [SortKey[], (order: SortKey[]) => void] {
  const [order, setOrder] = useState<SortKey[]>(() => {
    try {
      return parseSortOrder(localStorage.getItem(KEY)) ?? DEFAULT_SORT;
    } catch {
      // Storage unavailable; use the default.
      return DEFAULT_SORT;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, order.join(","));
    } catch {
      // Not remembered this time; harmless.
    }
  }, [order]);

  return [order, setOrder];
}
