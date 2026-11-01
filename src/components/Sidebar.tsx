import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ChevronRight, File, Folder, HardDrive, Layers } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { swallowClick } from "../hooks/useItemDrag";
import { useSectionDrag } from "../hooks/useSectionDrag";
import {
  favoriteSlot,
  moveSection,
  sectionLabel,
  sectionOrder,
  visibleSections,
  toggleSection,
  type Place,
  type SectionId,
} from "../lib/sidebar";
import type { OverviewRow } from "../lib/viewModels";
import { ProgressBar } from "./Glyphs";
import { PauseIcon, PlusIcon } from "./icons";

/**
 * The places on the left: the drives, or the folders getit may open, the
 * favorites, the views, and what's downloading, most recently started first. Items
 * dragged from a folder onto the favorites pin there, at the gap they're
 * dropped in; favorites drag to reorder. Sections drag by their headers to
 * reorder, a click on a header collapses or expands it, and right-clicking
 * one offers to hide its section, which Settings shows again.
 */
export function Sidebar({
  roots,
  drives,
  favorites,
  downloads,
  views,
  activeView,
  renamingView,
  onOpenView,
  onNewView,
  onStartRenameView,
  onRenameView,
  onCancelRenameView,
  onEditView,
  onDeleteView,
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
  onResize,
  onResetWidth,
  sections,
  onSections,
  collapsed,
  onCollapsed,
  onHideSection,
  hidden,
}: {
  roots: Place[];
  /** Whether `roots` are drives, rather than the folders the user chose. */
  drives: boolean;
  favorites: Place[];
  /** Running downloads, most recently started first. */
  downloads: OverviewRow[];
  views: { id: string; name: string }[];
  /** The view on screen, if one is. */
  activeView: string | null;
  /** The view whose name is being edited, if one is. */
  renamingView: string | null;
  onOpenView: (id: string) => void;
  onNewView: () => void;
  onStartRenameView: (id: string) => void;
  onRenameView: (id: string, name: string) => void;
  onCancelRenameView: () => void;
  /** Shows the view with its settings open. */
  onEditView: (id: string) => void;
  onDeleteView: (id: string) => void;
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
  /** The width the sidebar's right edge is dragged to. */
  onResize: (width: number) => void;
  /** Back to the default width, on a double-click on the edge. */
  onResetWidth: () => void;
  /** The sections' order, as stored; any missing come last. */
  sections: SectionId[];
  onSections: (sections: SectionId[]) => void;
  collapsed: SectionId[];
  onCollapsed: (collapsed: SectionId[]) => void;
  /** Hides a section from the sidebar; Settings shows it again. */
  onHideSection: (id: SectionId) => void;
  /** Sections the user hid. */
  hidden: SectionId[];
}) {
  const order = sectionOrder(sections);
  // The downloads show only while something is downloading.
  const shown = visibleSections(order, hidden, downloads.length > 0);
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
  const viewList = (
    <SidebarMenu>
      {views.map((view) => (
        <SidebarMenuItem key={view.id}>
          {renamingView === view.id ? (
            <ViewNameEditor
              initial={view.name}
              onCommit={(name) => onRenameView(view.id, name)}
              onCancel={onCancelRenameView}
            />
          ) : (
            <ContextMenu modal={false}>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  size="sm"
                  isActive={view.id === activeView}
                  onClick={() => onOpenView(view.id)}
                  onDoubleClick={() => onStartRenameView(view.id)}
                >
                  <Layers />
                  <span>{view.name}</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onEditView(view.id)}>View settings</ContextMenuItem>
                <ContextMenuItem onSelect={() => onStartRenameView(view.id)}>Rename</ContextMenuItem>
                <ContextMenuItem variant="destructive" onSelect={() => onDeleteView(view.id)}>
                  Delete view
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
  const content: Record<SectionId, { label: string; body: ReactNode; drop?: string; action?: ReactNode }> = {
    places: { label: sectionLabel("places", drives), body: places },
    // Dropping items on the header pins them first.
    favorites: { label: sectionLabel("favorites", drives), body: favoriteList, drop: favoriteSlot(0) },
    views: {
      label: sectionLabel("views", drives),
      body: viewList,
      action: (
        <SidebarGroupAction className="sidebar-section-action [&>svg]:size-[11px]" title="New view" onClick={onNewView}>
          <PlusIcon size={11} />
        </SidebarGroupAction>
      ),
    },
    downloads: {
      label: sectionLabel("downloads", drives),
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
              {/* Right-clicking a header offers to hide its section. */}
              <ContextMenu modal={false}>
                <SidebarGroupLabel asChild>
                  <ContextMenuTrigger asChild>
                    <CollapsibleTrigger
                      className="sidebar-section-head w-full"
                      data-drop={content[id].drop}
                      onMouseDown={(e) => startSectionDrag(e, id)}
                    >
                      {content[id].label}
                      {!content[id].action && <ChevronRight className="sidebar-section-chevron ml-auto" />}
                    </CollapsibleTrigger>
                  </ContextMenuTrigger>
                </SidebarGroupLabel>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onHideSection(id)}>Hide {content[id].label} from sidebar</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {content[id].action}
              <CollapsibleContent>{content[id].body}</CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize, double-click for the default width"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = e.currentTarget.parentElement!.getBoundingClientRect().width;
          dragResize((x) => onResize(startWidth + x - startX));
        }}
        onDoubleClick={onResetWidth}
      />
    </SidebarRoot>
  );
}

/** A view's name being edited in place: Enter or clicking away saves, Escape cancels. */
function ViewNameEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value);
    else onCancel();
  };
  return (
    <SidebarInput
      ref={ref}
      className="sidebar-rename"
      aria-label="View name"
      spellCheck={false}
      autoCorrect="off"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** Follows the pointer across the window until the button comes up, with the resize cursor everywhere. */
function dragResize(onMove: (x: number) => void) {
  const root = document.documentElement;
  root.classList.add("col-resizing");
  const move = (e: MouseEvent) => onMove(e.clientX);
  const up = () => {
    swallowClick();
    stop();
  };
  const stop = () => {
    root.classList.remove("col-resizing");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    window.removeEventListener("blur", stop);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  window.addEventListener("blur", stop);
}
