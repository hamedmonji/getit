import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for less motion, kept current as the setting changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
