import { useEffect, useState } from "react";

const QUERY = "(prefers-color-scheme: dark)";

/** Whether the system is in dark mode, updated as it changes. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark;
}
