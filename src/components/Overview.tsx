import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatSpeed } from "../lib/format";
import type { FileVm, OverviewRow, OverviewShow } from "../lib/viewModels";
import { ActionButton, ProgressBar } from "./Glyphs";
import { PauseIcon } from "./icons";

const SHOWS: { show: OverviewShow; label: string }[] = [
  { show: "active", label: "Active" },
  { show: "all", label: "All" },
];

/**
 * The side panel listing downloads from every queue, only the running ones or
 * all of them, most recently started first. Clicking one goes to its folder
 * with it selected.
 */
export function Overview({
  rows,
  show,
  onShow,
  running,
  speed,
  onOpenFile,
  onAction,
  onPauseAll,
}: {
  rows: OverviewRow[];
  /** Which downloads `rows` holds. */
  show: OverviewShow;
  onShow: (show: OverviewShow) => void;
  /** Downloads running anywhere, and their speed together. */
  running: number;
  speed: number;
  onOpenFile: (dir: string, id: string) => void;
  onAction: (vm: FileVm) => void;
  /** Stops everything in every queue. */
  onPauseAll: () => void;
}) {
  return (
    <aside className="overview" aria-label="Overview">
      <div className="overview-head">
        <span className="overview-title">Downloads</span>
        <span className="overview-total" title={`${running} running`}>
          {running > 0 && formatSpeed(speed)}
        </span>
        {running > 0 && (
          <Button variant="outline" size="xs" title="Pause every queue and download" onClick={onPauseAll}>
            <PauseIcon />
            Stop all
          </Button>
        )}
      </div>
      <Tabs value={show} onValueChange={(s) => onShow(s as OverviewShow)} className="min-h-0 flex-1 gap-0">
        <div className="panel-tabs">
          <TabsList className="w-full">
            {SHOWS.map(({ show, label }) => (
              <TabsTrigger key={show} value={show}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* The same list either way, so one panel, for whichever tab is chosen. */}
        <TabsContent value={show} className="flex min-h-0 flex-col">
          <div className="overview-body">
            {rows.length ? (
              <ItemGroup>
                {rows.map(({ file: f, dir, detail }) => (
                  <Item
                    key={f.id}
                    size="xs"
                    className="cursor-pointer hover:bg-muted"
                    title={f.info}
                    onClick={() => onOpenFile(dir, f.id)}
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full" style={{ color: f.nameColor }}>
                        <span className="truncate">{f.name}</span>
                      </ItemTitle>
                      <ProgressBar className="row-bar overview-bar" pct={f.pct} color={f.color} />
                      <ItemDescription>{detail}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ActionButton variant="secondary" size="icon-sm" vm={f} onAction={onAction} />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <div className="overview-empty">{show === "active" ? "Nothing is downloading." : "No downloads yet."}</div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
