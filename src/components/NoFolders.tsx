import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/**
 * Shown in place of the folder view once every folder the user chose is gone:
 * they choose another, or give getit Full Disk Access to open any folder.
 * macOS may apply that only after a restart.
 */
export function NoFolders({
  asked,
  onChooseFolder,
  onFullDiskAccess,
  onReveal,
  onRestart,
}: {
  /** Whether the user already went to turn on Full Disk Access. */
  asked: boolean;
  onChooseFolder: () => void;
  onFullDiskAccess: () => void;
  /** Shows getit in Finder, to drag into the Full Disk Access list; null when it isn't in an app bundle. */
  onReveal: (() => void) | null;
  onRestart: () => void;
}) {
  return (
    // Keeps the folder view's marquee and deselection away from the buttons.
    <Empty className="py-20" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <EmptyHeader>
        <EmptyTitle>getit has no folder to open</EmptyTitle>
        <EmptyDescription>
          {asked
            ? "Add getit to the Full Disk Access list: drag it in from Finder, or click + and choose it. Turn it on, then restart getit if it doesn't go on by itself."
            : "The folders you chose for getit were deleted. Choose another folder, or give getit Full Disk Access to open any folder."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button onClick={onChooseFolder}>Choose a Folder</Button>
          <Button variant="outline" onClick={onFullDiskAccess}>
            {asked ? "Open Settings" : "Give Full Disk Access"}
          </Button>
          {asked && onReveal && (
            <Button variant="outline" onClick={onReveal}>
              Show getit in Finder
            </Button>
          )}
          {asked && (
            <Button variant="outline" onClick={onRestart}>
              Restart getit
            </Button>
          )}
        </div>
      </EmptyContent>
    </Empty>
  );
}
