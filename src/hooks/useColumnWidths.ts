import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { parseColumnWidths, type ColumnWidths } from "../lib/columns";

const KEY = "getit.listColumns";

/** The list view's column widths, remembered in localStorage like the other preferences. */
export function useColumnWidths(): [ColumnWidths, Dispatch<SetStateAction<ColumnWidths>>] {
  const [widths, setWidths] = useState<ColumnWidths>(() => {
    try {
      return parseColumnWidths(localStorage.getItem(KEY));
    } catch {
      // Storage unavailable; use the defaults.
      return parseColumnWidths(null);
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(widths));
    } catch {
      // Not remembered this time; harmless.
    }
  }, [widths]);

  return [widths, setWidths];
}
