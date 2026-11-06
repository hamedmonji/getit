import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { captionButtons, type CaptionAction } from "../lib/windowControls";

const run: Record<CaptionAction, () => Promise<void>> = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
};

/** Windows' minimize, maximize and close buttons, at the toolbar's right end. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const check = () => win.isMaximized().then(setMaximized, () => {});
    check();
    const unlisten = win.onResized(check);
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  return (
    <div className="window-controls">
      {captionButtons(maximized).map((b) => (
        <Button
          key={b.action}
          variant="ghost"
          title={b.label}
          aria-label={b.label}
          className={"window-control" + (b.action === "close" ? " window-control-close" : "")}
          onClick={() => run[b.action]().catch((e) => console.error(e))}
        >
          {b.glyph}
        </Button>
      ))}
    </div>
  );
}
