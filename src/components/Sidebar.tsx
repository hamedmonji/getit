import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ChevronRight, File, Folder, HardDrive } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSectionDrag } from "../hooks/useSectionDrag";
import {
  favoriteSlot,
  moveSection,
  sectionOrder,
  toggleSection,
  type Place,
  type SectionId,
} from "../lib/sidebar";
import type { OverviewRow } from "../lib/viewModels";
import { ProgressBar } from "./Glyphs";
import { PauseIcon } from "./icons";

/**
 * The places on the left: the drives, or the folders getit may open, the
 * favorites, and what's downloading, most recently started first. Items
 * dragged from a folder onto the favorites pin there, at the gap they're
 * dropped in; favorites drag to reorder. Sections drag by their headers to
 * reorder, and a click on a header collapses or expands it.
 */
export function Sidebar({
  roots,
  drives,
  favorites,
  downloads,
  active,
  dropTarget,
  dragging,
  fileManager,
  onOpen,
  onFavoriteMouseDown,
  onUnpin,
  onReveal,
  onOpenDownload,
  onPauseAll,
  sections,
  onSections,
  collapsed,
  onCollapsed,
}: {
  roots: Place[];
  /** Whether `roots` are drives, rather than the folders the user chose. */
  drives: boolean;
  favorites: Place[];
  /** Running downloads, most recently started first. */
  downloads: OverviewRow[];
  /** The folder on screen, highlighted where it's in the sidebar. */
  active: string;
  /** The `data-drop` under the dragged items, if it takes them. */
  dropTarget: string | null;
  dragging: boolean;
  fileManager: string;
  onOpen: (place: Place) => void;
  onFavoriteMouseDown: (path: string, e: ReactMouseEvent) => void;
  onUnpin: (path: string) => void;
  onReveal: (path: string) => void;
  /** Goes to a download's folder with it selected. */
  onOpenDownload: (dir: string, id: string) => void;
  /** Stops everything in every queue. */
  onPauseAll: () => void;
  /** The sections' order, as stored; any missing come last. */
  sections: SectionId[];
  onSections: (sections: SectionId[]) => void;
  collapsed: SectionId[];
  onCollapsed: (collapsed: SectionId[]) => void;
}) {
  const order = sectionOrder(sections);
  // The downloads show only while something is downloading.
  const shown = order.filter((id) => id !== "downloads" || downloads.length > 0);
  const contentRef = useRef<HTMLDivElement>(null);
  const { drag: sectionDrag, start: startSectionDrag } = useSectionDrag(contentRef, (id, index) =>
    onSections(moveSection(order, shown, id, index)),
  );
  const slot = (index: number) => (
    <div
      className={"sidebar-slot" + (dropTarget === favoriteSlot(index) ? " drop-target" : "")}
      data-drop={favoriteSlot(index)}
    />
  );
  const icon = (place: Place) => (place.file ? <File /> : drives && roots.includes(place) ? <HardDrive /> : <Folder />);
  const button = (place: Place, droppable: boolean, onMouseDown?: (e: ReactMouseEvent) => void) => (
    <SidebarMenuButton
      size="sm"
      isActive={!place.file && place.path === active}
      className={dropTarget === place.path ? "drop-target" : undefined}
      title={place.path}
      data-drop={droppable && !place.file ? place.path : undefined}
      onMouseDown={onMouseDown}
      onClick={() => onOpen(place)}
    >
      {icon(place)}
      <span>{place.name}</span>
    </SidebarMenuButton>
  );

  const places = (
    <SidebarMenu>
      {roots.map((place) => (
        <SidebarMenuItem key={place.path}>{button(place, !drives)}</SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
  const favoriteList = (
    <>
      <SidebarMenu>
        {favorites.map((place, i) => (
          <SidebarMenuItem key={place.path}>
            {slot(i)}
            <ContextMenu modal={false}>
              <ContextMenuTrigger asChild>
                {button(place, true, (e) => e.button === 0 && onFavoriteMouseDown(place.path, e))}
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onReveal(place.path)}>Show in {fileManager}</ContextMenuItem>
                <ContextMenuItem onSelect={() => onUnpin(place.path)}>Remove from Favorites</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      {/* Below the last favorite pins at the end. */}
      <div
        className={
          "sidebar-end" + (dropTarget === favoriteSlot(favorites.length) && favorites.length ? " drop-target" : "")
        }
        data-drop={favoriteSlot(favorites.length)}
      >
        {!favorites.length && (
          <div className={"sidebar-hint" + (dropTarget === favoriteSlot(0) ? " drop-target" : "")}>
            {dragging ? "Drop to add to Favorites" : "Drag folders here to pin them"}
          </div>
        )}
      </div>
    </>
  );
  const downloadList = (
    <SidebarMenu>
      {downloads.map(({ file: f, dir, detail }) => (
        <SidebarMenuItem key={f.id}>
          <SidebarMenuButton
            size="sm"
            className="sidebar-download"
            title={`${f.name}\n${f.info}`}
            onClick={() => onOpenDownload(dir, f.id)}
          >
            <span className="truncate">{f.name}</span>
            <ProgressBar className="row-bar" pct={f.pct} color={f.color} />
            <span className="sidebar-download-detail truncate">{detail}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
  const content: Record<SectionId, { label: string; body: ReactNode; drop?: string; action?: ReactNode }> = {
    places: { label: drives ? "Locations" : "Folders", body: places },
    // Dropping items on the header pins them first.
    favorites: { label: "Favorites", body: favoriteList, drop: favoriteSlot(0) },
    downloads: {
      label: "Downloading",
      body: downloadList,
      // In the chevron's place; the header still collapses the section.
      action: (
        <SidebarGroupAction className="sidebar-section-action" title="Pause every queue and download" onClick={onPauseAll}>
          <PauseIcon />
        </SidebarGroupAction>
      ),
    },
  };

  return (
    <SidebarRoot collapsible="none" className="sidebar">
      <SidebarContent ref={contentRef}>
        {shown.map((id, i) => (
          <Collapsible
            key={id}
            open={!collapsed.includes(id)}
            onOpenChange={() => onCollapsed(toggleSection(collapsed, id))}
          >
            <SidebarGroup
              data-section={id}
              className={
                (sectionDrag?.id === id ? "section-dragging" : "") +
                (sectionDrag?.index === i ? " section-drop-before" : "") +
                (sectionDrag?.index === shown.length && i === shown.length - 1 ? " section-drop-after" : "")
              }
            >
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger
                  className="sidebar-section-head w-full"
                  data-drop={content[id].drop}
                  onMouseDown={(e) => startSectionDrag(e, id)}
                >
                  {content[id].label}
                  {!content[id].action && <ChevronRight className="sidebar-section-chevron ml-auto" />}
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              {content[id].action}
              <CollapsibleContent>{content[id].body}</CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
    </SidebarRoot>
  );
}
