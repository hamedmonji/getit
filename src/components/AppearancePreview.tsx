import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useDirListing } from "../hooks/useDirListing";
import { previewContent, previewPaths, fitScale, PREVIEW_SIZE } from "../lib/appearancePreview";
import { waveDelays, waveLength } from "../lib/onboarding";
import { engine } from "../lib/engine";
import { crumbsFrom } from "../lib/paths";
import { FILE_MANAGER } from "../lib/platform";
import { SECTIONS } from "../lib/sidebar";
import { DEFAULT_VIEWS } from "../lib/views";
import { Toolbar } from "./Bars";
import { IconView } from "./ItemViews";
import { Sidebar } from "./Sidebar";

const noop = () => {};
const none = new Set<string>();

/**
 * getit itself, scaled down and not to be clicked: its toolbar, sidebar and
 * icon view on a pretend Downloads folder in getit's caches, which macOS lets
 * it read without asking. Drawn by the same components and colours as the app,
 * so it always looks as getit will. Each time `wave` goes up, its sidebar rows
 * and then its tiles bounce one after another as they take the new colours.
 */
export function AppearancePreview({ wave = 0 }: { wave?: number }) {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    engine.appearancePreviewDir().then(setHome, (e) => console.error("Couldn't make the preview's folder:", e));
  }, []);
  const paths = home ? previewPaths(home) : null;
  const listing = useDirListing(paths?.downloads ?? null, "");

  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setScale(fitScale(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const app = useRef<HTMLDivElement>(null);
  const [waving, setWaving] = useState(false);
  useEffect(() => {
    const el = app.current;
    if (!wave || !el) return;
    const items = [...el.querySelectorAll<HTMLElement>('[data-sidebar="menu-item"], .tile')];
    waveDelays(items.length).forEach((ms, i) => items[i].style.setProperty("--wave-delay", `${ms}ms`));
    setWaving(true);
    const timer = setTimeout(() => setWaving(false), waveLength());
    return () => clearTimeout(timer);
  }, [wave]);

  const content = home && paths && listing.path === paths.downloads ? previewContent(home, listing) : null;
  return (
    <div ref={frame} className="w-full">
      <div
        className="appearance-preview"
        style={{ width: PREVIEW_SIZE.width * scale, height: PREVIEW_SIZE.height * scale }}
      >
        {home && paths && (
          <div
            ref={app}
            inert
            aria-hidden
            // Alternates, so a pick during a wave starts it over.
            data-wave={waving ? (wave % 2 ? "odd" : "even") : undefined}
            className="app"
            style={{ ...PREVIEW_SIZE, transform: `scale(${scale})`, transformOrigin: "top left" }}
          >
            <Toolbar
              canBack={false}
              canForward={false}
              canUp={false}
              onBack={noop}
              onForward={noop}
              onUp={noop}
              cwdLabel="~/Downloads"
              crumbs={crumbsFrom(home, paths.downloads)}
              onCrumb={noop}
              dropTarget={null}
              addressOpen={false}
              onAddressOpen={noop}
              query=""
              onQuery={noop}
              searchAll={false}
              onSearchAll={noop}
              searchKinds={[]}
              onSearchKinds={noop}
              onGoTo={async () => {}}
              onSearchResults={noop}
              mode="Icons"
              onMode={noop}
              showAllFolders
              onToggleFolders={noop}
              queueState="running"
              onToggleQueue={noop}
              onToggleAdd={noop}
              onToggleSettings={noop}
            />
            <div className="main">
              <SidebarProvider
                open
                className="min-h-0 w-auto flex-none"
                style={{ "--sidebar-width": "200px" } as CSSProperties}
              >
                <Sidebar
                  roots={content?.roots ?? []}
                  drives={false}
                  favorites={content?.favorites ?? []}
                  downloads={content?.running ?? []}
                  views={DEFAULT_VIEWS}
                  activeView={null}
                  renamingView={null}
                  onOpenView={noop}
                  onNewView={noop}
                  onStartRenameView={noop}
                  onRenameView={noop}
                  onCancelRenameView={noop}
                  onEditView={noop}
                  onDeleteView={noop}
                  active={paths.downloads}
                  dropTarget={null}
                  dragging={false}
                  fileManager={FILE_MANAGER}
                  onOpen={noop}
                  onFavoriteMouseDown={noop}
                  onUnpin={noop}
                  onReveal={noop}
                  onOpenDownload={noop}
                  onPauseAll={noop}
                  onResize={noop}
                  onResetWidth={noop}
                  sections={[...SECTIONS]}
                  onSections={noop}
                  collapsed={[]}
                  onCollapsed={noop}
                  hidden={[]}
                  onHideSection={noop}
                />
              </SidebarProvider>
              <div className="content-column">
                <div className="content">
                  {content && (
                    <IconView
                      folders={content.folders}
                      files={content.files}
                      pending={[]}
                      selected={new Set([content.selected])}
                      onItemMouseDown={noop}
                      onItemClick={noop}
                      onOpenFolder={noop}
                      onOpenFile={noop}
                      onAction={noop}
                      editing={null}
                      onRename={async () => {}}
                      onCancelRename={noop}
                      dragging={none}
                      dropTarget={null}
                      cut={none}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
