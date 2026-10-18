import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { menuItems, type MenuContext, type MenuItem } from "../lib/menus";

/**
 * The right-click menu for `target`: a folder path or download id, or null for
 * the folder's empty space. Goes in a ContextMenuContent, which renders it only
 * while the menu shows, so a closed menu builds nothing.
 */
export function ContextMenuItems({ ctx, target }: { ctx: MenuContext; target: string | null }) {
  return (
    <>
      {menuItems(ctx, target).map((item, i) => (
        <Item key={i} item={item} />
      ))}
    </>
  );
}

function Item({ item }: { item: MenuItem }) {
  switch (item.kind) {
    case "separator":
      return <ContextMenuSeparator />;
    case "header":
      return <ContextMenuLabel>{item.label}</ContextMenuLabel>;
    case "stepper":
      // Plain buttons rather than menu items, so changing it keeps the menu open.
      return (
        <div className="flex items-center justify-between gap-3 px-1.5 py-1 text-sm">
          <span>{item.label}</span>
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Fewer"
              disabled={item.value <= item.min}
              onClick={() => item.onChange(Math.max(item.min, item.value - 1))}
            >
              −
            </Button>
            <ButtonGroupText>{item.value}</ButtonGroupText>
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="More"
              disabled={item.value >= item.max}
              onClick={() => item.onChange(Math.min(item.max, item.value + 1))}
            >
              +
            </Button>
          </ButtonGroup>
        </div>
      );
    case "action": {
      const label = (
        <>
          {item.label}
          {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
        </>
      );
      if (item.checked !== undefined) {
        return (
          <ContextMenuCheckboxItem checked={item.checked} disabled={item.disabled} onSelect={item.onSelect}>
            {label}
          </ContextMenuCheckboxItem>
        );
      }
      return (
        <ContextMenuItem variant={item.danger ? "destructive" : "default"} disabled={item.disabled} onSelect={item.onSelect}>
          {label}
        </ContextMenuItem>
      );
    }
  }
}
