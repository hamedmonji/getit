import { describe, expect, it } from "vitest";
import { dockOverlayLayout, dockStatus, sameDockStatus } from "./dock";
import type { DownloadItem, DownloadStatus } from "./engine";

const MB = 1024 * 1024;

function item(id: string, status: DownloadStatus, downloaded: number, total: number | null): DownloadItem {
  return {
    id,
    queue_id: "q",
    url: "http://example.com/" + id,
    file_name: id,
    total_bytes: total,
    downloaded,
    status,
    resumable: true,
    etag: null,
    last_modified: null,
    error: null,
    added_at: 0,
  };
}

function byId(...items: DownloadItem[]): Record<string, DownloadItem> {
  return Object.fromEntries(items.map((d) => [d.id, d]));
}

describe("dockStatus", () => {
  it("shows nothing when nothing is downloading", () => {
    expect(dockStatus({}, {})).toBeNull();
    const idle = byId(
      item("a", "queued", 0, 100),
      item("b", "paused", 50, 100),
      item("c", "completed", 100, 100),
      item("d", "failed", 10, 100),
    );
    expect(dockStatus(idle, { b: 5 * MB })).toBeNull();
  });

  it("combines progress by bytes and sums speeds of running downloads", () => {
    const downloads = byId(
      item("a", "downloading", 10 * MB, 100 * MB),
      item("b", "downloading", 90 * MB, 100 * MB),
      item("c", "paused", 0, 1000 * MB),
    );
    expect(dockStatus(downloads, { a: 1 * MB, b: 2.2 * MB })).toEqual({ progress: 50, label: "3.2 MB/s" });
  });

  it("weighs progress by size, not per download", () => {
    const downloads = byId(item("a", "downloading", 100, 100), item("b", "downloading", 0, 300));
    expect(dockStatus(downloads, {})?.progress).toBe(25);
  });

  it("leaves downloads of unknown size out of progress but counts their speed", () => {
    const downloads = byId(item("a", "downloading", 30, 100), item("b", "downloading", 5000, null));
    expect(dockStatus(downloads, { a: 512 * 1024, b: 512 * 1024 })).toEqual({ progress: 30, label: "1.0 MB/s" });
  });

  it("has no progress when no running download knows its size", () => {
    expect(dockStatus(byId(item("a", "downloading", 5000, null)), { a: 2048 })).toEqual({
      progress: null,
      label: "2 KB/s",
    });
  });

  it("has no label before any speed is known", () => {
    expect(dockStatus(byId(item("a", "downloading", 0, 100)), {})).toEqual({ progress: 0, label: null });
  });

  it("rounds progress down so it reaches 100 only when done", () => {
    expect(dockStatus(byId(item("a", "downloading", 999, 1000)), {})?.progress).toBe(99);
  });

  it("caps a download that overshoots its size", () => {
    expect(dockStatus(byId(item("a", "downloading", 150, 100)), {})?.progress).toBe(100);
  });
});

describe("sameDockStatus", () => {
  it("compares what the Dock shows", () => {
    expect(sameDockStatus(null, null)).toBe(true);
    expect(sameDockStatus(null, { progress: 0, label: null })).toBe(false);
    expect(sameDockStatus({ progress: 5, label: "1.0 MB/s" }, { progress: 5, label: "1.0 MB/s" })).toBe(true);
    expect(sameDockStatus({ progress: 5, label: "1.0 MB/s" }, { progress: 6, label: "1.0 MB/s" })).toBe(false);
    expect(sameDockStatus({ progress: 5, label: "1.0 MB/s" }, { progress: 5, label: "1.1 MB/s" })).toBe(false);
  });
});

describe("dockOverlayLayout", () => {
  it("draws nothing when nothing is downloading or nothing is known yet", () => {
    expect(dockOverlayLayout(null)).toBeNull();
    expect(dockOverlayLayout({ progress: null, label: null })).toBeNull();
  });

  it("puts the speed above the bar at the bottom of the icon", () => {
    const layout = dockOverlayLayout({ progress: 25, label: "3.2 MB/s" })!;
    const { panel, text, bar } = layout;
    expect(text?.value).toBe("3.2 MB/s");
    expect(text!.y).toBeLessThan(bar!.track.y);
    expect(panel.y + panel.height).toBeCloseTo(0.96);
    expect(panel.y).toBeGreaterThan(0.4);
    expect(bar!.track.y + bar!.track.height).toBeLessThan(panel.y + panel.height);
    expect(text!.maxWidth).toBeCloseTo(bar!.track.width);
  });

  it("fills the bar by progress", () => {
    const { bar } = dockOverlayLayout({ progress: 25, label: null })!;
    expect(bar!.fill.x).toBe(bar!.track.x);
    expect(bar!.fill.width).toBeCloseTo(bar!.track.width / 4);
    expect(dockOverlayLayout({ progress: 0, label: null })!.bar!.fill.width).toBe(0);
    expect(dockOverlayLayout({ progress: 100, label: null })!.bar!.fill.width).toBeCloseTo(bar!.track.width);
  });

  it("shrinks the panel to what it shows", () => {
    const both = dockOverlayLayout({ progress: 10, label: "1.0 MB/s" })!;
    const barOnly = dockOverlayLayout({ progress: 10, label: null })!;
    const textOnly = dockOverlayLayout({ progress: null, label: "1.0 MB/s" })!;
    expect(barOnly.text).toBeNull();
    expect(textOnly.bar).toBeNull();
    expect(barOnly.panel.height).toBeLessThan(both.panel.height);
    expect(textOnly.panel.height).toBeLessThan(both.panel.height);
    expect(textOnly.panel.y + textOnly.panel.height).toBeCloseTo(0.96);
  });
});
