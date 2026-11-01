import { useEffect, useState } from "react";
import { minuteOf } from "../lib/schedule";

/**
 * Minutes since local midnight, updated at the start of every minute and
 * whenever the window comes back into view, so a changed clock or time zone
 * shows right away.
 */
export function useNowMinute(): number {
  const [minute, setMinute] = useState(() => minuteOf(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = new Date();
      setMinute(minuteOf(now));
      clearTimeout(timer);
      timer = setTimeout(tick, (60 - now.getSeconds()) * 1000 - now.getMilliseconds());
    };
    tick();
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return minute;
}
