import { useEffect, useState } from "react";
import { FINISH, FINISH_TITLE } from "../lib/onboarding";

/**
 * Step 3's finish, over the whole window: "flood" fills it in `color` from
 * `origin` and says hello; "fade" starts filled and fades away, over getit.
 */
export function FinishFlood({
  color,
  phase,
  origin,
  onFaded,
}: {
  color: string;
  phase: "flood" | "fade";
  /** Where the flood starts, in window pixels; the window's centre if not given. */
  origin?: { x: number; y: number };
  onFaded?: () => void;
}) {
  // A flood starts closed and opens a moment later, so it animates; a fade
  // starts open and visible, then fades.
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    const start = setTimeout(() => setMoved(true), FINISH.startMs);
    const done = phase === "fade" ? setTimeout(() => onFaded?.(), FINISH.startMs + FINISH.fadeMs) : undefined;
    return () => {
      clearTimeout(start);
      clearTimeout(done);
    };
  }, []);

  const open = phase === "fade" || moved;
  const at = origin ? `${origin.x}px ${origin.y}px` : "50% 50%";
  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2"
      style={{
        background: color,
        clipPath: `circle(${open ? 150 : 0}% at ${at})`,
        opacity: phase === "fade" && moved ? 0 : 1,
        transition:
          phase === "flood"
            ? "clip-path .75s cubic-bezier(.65,0,.25,1)"
            : `opacity ${FINISH.fadeMs}ms ease`,
      }}
    >
      <div
        className="text-[30px] font-bold tracking-[-0.03em] text-white"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? "none" : "translateY(10px)",
          transition:
            phase === "flood" ? "opacity .4s ease .45s, transform .5s cubic-bezier(.3,1.5,.5,1) .45s" : "none",
        }}
      >
        {FINISH_TITLE}
      </div>
    </div>
  );
}
