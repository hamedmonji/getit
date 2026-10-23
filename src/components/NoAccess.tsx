import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Shown in place of a folder the system won't let getit read. On macOS that's
 * usually a privacy-protected folder (Documents, Desktop, ...), which getit
 * opens once it has Full Disk Access. macOS may apply that only after a restart.
 */
export function NoAccess({
  name,
  asked,
  onSettings,
  onReveal,
  onRestart,
}: {
  /** The folder's name, such as "Documents". */
  name: string;
  /** Whether the user already went to turn on Full Disk Access. */
  asked: boolean;
  onSettings: () => void;
  /** Shows getit in Finder, to drag into the Full Disk Access list; null when it isn't in an app bundle. */
  onReveal: (() => void) | null;
  onRestart: () => void;
}) {
  if (!IS_MAC) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyDescription>getit doesn't have permission to open “{name}”.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    // Keeps the folder view's marquee and deselection away from the buttons.
    <Empty className="py-20" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <EmptyHeader>
        <EmptyTitle>getit can't open “{name}”</EmptyTitle>
        <EmptyDescription>
          {asked
            ? "Add getit to the Full Disk Access list: drag it in from Finder, or click + and choose it. Turn it on, then restart getit so macOS lets it in."
            : "macOS protects this folder. Give getit Full Disk Access in Privacy & Security to open it, along with Desktop and Downloads."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button variant={asked ? "outline" : "default"} onClick={onSettings}>
            {asked ? "Open Settings" : "Open Full Disk Access Settings"}
          </Button>
          {asked && onReveal && (
            <Button variant="outline" onClick={onReveal}>
              Show getit in Finder
            </Button>
          )}
          {asked && <Button onClick={onRestart}>Restart getit</Button>}
        </div>
      </EmptyContent>
    </Empty>
  );
}
