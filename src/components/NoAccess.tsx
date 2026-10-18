import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Shown in place of a folder the system won't let getit read. On macOS that's
 * usually a privacy-protected folder (Documents, Desktop, ...): choosing it in an
 * Open panel lets getit in, and System Settings can allow it for good.
 */
export function NoAccess({
  name,
  asked,
  onGrant,
  onSettings,
}: {
  /** The folder's name, such as "Documents". */
  name: string;
  /** Whether the user already tried granting access to this folder. */
  asked: boolean;
  onGrant: () => void;
  onSettings: () => void;
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
            ? "macOS still isn't letting getit in. Allow getit under Files & Folders (or Full Disk Access) in Privacy & Security, then come back."
            : `macOS protects this folder. Choose it in the next window to let getit open it.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button variant={asked ? "outline" : "default"} onClick={onGrant}>
            Grant Access…
          </Button>
          <Button variant={asked ? "default" : "outline"} onClick={onSettings}>
            Open Privacy Settings
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}
