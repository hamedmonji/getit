import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { engine } from "../lib/engine";
import { canRefresh, refreshPrefill } from "../lib/links";

/**
 * Asks for a new link for a download whose link expired, starting with a link
 * on the clipboard if there's a new one. A link the browser extension captures
 * while it's open takes its place, noted as such. Saving gives the download
 * the link and resumes it from where it got to.
 */
export function RefreshLink({
  download,
  captured,
  onSave,
  onClose,
}: {
  /** The download being given a new link, or null when the dialog is closed. */
  download: { name: string; url: string } | null;
  /** The latest link the browser captured while it's open. */
  captured: string | null;
  onSave: (url: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  // Filled in when it opens, not on every update of the download it's for.
  const current = download?.url ?? null;
  useEffect(() => {
    if (current === null) return;
    setUrl(current);
    let live = true;
    engine.readClipboard().then(
      (clip) => live && setUrl(refreshPrefill(clip, current)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [current]);
  useEffect(() => {
    if (captured) setUrl(captured);
  }, [captured]);

  const ok = !!download && canRefresh(url, download.url);
  const save = () => {
    if (!ok) return;
    onSave(url.trim());
    onClose();
  };
  return (
    <Dialog open={!!download} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="[&_[data-slot=dialog-close]]:text-ink-muted">
        <DialogHeader>
          <DialogTitle>Refresh Link</DialogTitle>
          <DialogDescription className="break-all">
            Paste a new link for {download?.name}, or start the download again in your browser and it's captured
            here. It carries on from where it stopped.
          </DialogDescription>
        </DialogHeader>
        <Input
          className="mono"
          autoFocus
          aria-label="New link"
          placeholder="https://"
          value={url}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        {captured && url === captured && <p className="refresh-captured">Link captured from browser</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok} onClick={save}>
            Refresh and Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
