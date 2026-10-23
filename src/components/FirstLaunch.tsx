import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";

/**
 * Asked on first launch on macOS, which protects Desktop, Documents and
 * Downloads: choose one folder for getit to work in, or give it Full Disk
 * Access to open them all. Can't be dismissed without choosing.
 */
export function FirstLaunch({
  open,
  onChooseFolder,
  onFullDiskAccess,
}: {
  open: boolean;
  onChooseFolder: () => void;
  onFullDiskAccess: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Where should getit download?</DialogTitle>
          <DialogDescription>
            macOS protects your Desktop, Documents and Downloads folders. Choose how getit gets in.
          </DialogDescription>
        </DialogHeader>
        <ItemGroup className="gap-3">
          <Item variant="outline">
            <ItemContent>
              <ItemTitle>Choose a folder</ItemTitle>
              <ItemDescription>getit opens there and only needs access to that folder.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button onClick={onChooseFolder}>Choose…</Button>
            </ItemActions>
          </Item>
          <Item variant="outline">
            <ItemContent>
              <ItemTitle>Give Full Disk Access</ItemTitle>
              <ItemDescription>getit can open every folder. Add getit to the list in System Settings, turn it on, then restart getit.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="outline" onClick={onFullDiskAccess}>
                Open Settings
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </DialogContent>
    </Dialog>
  );
}
