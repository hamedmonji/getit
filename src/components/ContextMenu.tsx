import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | {
      kind: "action";
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** Shows a check mark column; true checks it. */
      checked?: boolean;
      /** Keyboard shortcut shown on the right, such as "⌘C". */
      shortcut?: string;
    }
  | { kind: "separator" }
  | { kind: "header"; label: string }
  /** A −/+ control; changing it keeps the menu open. */
  | {
      kind: "stepper";
      label: string;
      value: number;
      min: number;
      max: number;
      onChange: (value: number) => void;
    };

const EDGE = 8;

/** A right-click menu at (x, y), kept inside the window. Closes on outside click, Escape or blur. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        switch (item.kind) {
          case "separator":
            return <div key={i} className="menu-separator" />;
          case "header":
            return (
              <div key={i} className="menu-header">
                {item.label}
              </div>
            );
          case "stepper":
            return (
              <div key={i} className="menu-stepper">
                <span>{item.label}</span>
                <div className="menu-stepper-control">
                  <button
                    disabled={item.value <= item.min}
                    onClick={() => item.onChange(Math.max(item.min, item.value - 1))}
                  >
                    −
                  </button>
                  <span className="mono">{item.value}</span>
                  <button
                    disabled={item.value >= item.max}
                    onClick={() => item.onChange(Math.min(item.max, item.value + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          case "action":
            return (
              <button
                key={i}
                role="menuitem"
                className={"menu-item" + (item.danger ? " danger" : "")}
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                {item.checked !== undefined && <span className="menu-check">{item.checked ? "✓" : ""}</span>}
                {item.label}
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </button>
            );
        }
      })}
    </div>
  );
}
