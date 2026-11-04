import { describe, expect, it } from "vitest";
import { justUpdated, testDownloadEvents, testVersion, updateCard } from "./update";

const actions = (card: ReturnType<typeof updateCard>) => card?.actions.map((a) => [a.action, a.label, a.primary]);

describe("updateCard", () => {
  it("offers to download a new version, or later", () => {
    const card = updateCard({ kind: "available" }, "8.2", 0);
    expect(card?.title).toBe("Version 8.2 is available");
    expect(actions(card)).toEqual([
      ["later", "Later", false],
      ["download", "Download update", true],
    ]);
  });

  it("shows the download's progress, with nothing to press", () => {
    const card = updateCard({ kind: "downloading", pct: 42 }, "8.2", 0);
    expect(card).toMatchObject({ title: "Downloading 8.2", progress: true, pct: 42, actions: [] });
    expect(updateCard({ kind: "available" }, "8.2", 0)?.progress).toBe(false);
    expect(updateCard({ kind: "downloading", pct: null }, "8.2", 0)?.pct).toBeNull();
  });

  it("restarts once ready, or waits for running downloads first", () => {
    const idle = updateCard({ kind: "ready" }, "8.2", 0);
    expect(idle).toMatchObject({ title: "Version 8.2 is ready", detail: "Restart to finish updating" });
    expect(actions(idle)?.[1]).toEqual(["restart", "Restart to update", true]);
    expect(actions(updateCard({ kind: "ready" }, "8.2", 2))?.[1]).toEqual(["wait", "Restart when done", true]);
  });

  it("says how many downloads it waits for, and can restart now", () => {
    const card = updateCard({ kind: "waiting" }, "8.2", 1);
    expect(card).toMatchObject({ icon: "waiting", title: "Updates when downloads finish", detail: "1 download left" });
    expect(actions(card)).toEqual([["restart", "Restart now", true]]);
    expect(updateCard({ kind: "waiting" }, "8.2", 3)?.detail).toBe("3 downloads left");
  });

  it("offers to try a failed download again", () => {
    const card = updateCard({ kind: "failed", error: "offline" }, "8.2", 0);
    expect(card).toMatchObject({ title: "Couldn't download version 8.2", detail: "offline" });
    expect(actions(card)?.[1]).toEqual(["download", "Try again", true]);
  });

  it("hides while restarting, and says when it's updated", () => {
    expect(updateCard({ kind: "restarting" }, "8.2", 0)).toBeNull();
    expect(updateCard({ kind: "updated" }, "8.2", 0)).toMatchObject({ icon: "done", title: "Updated to 8.2", actions: [] });
  });
});

describe("justUpdated", () => {
  it("is true only when getit came back at the version it was updating to", () => {
    expect(justUpdated("8.2", "8.2")).toBe(true);
    expect(justUpdated("8.2", "8.1")).toBe(false);
    expect(justUpdated(null, "8.2")).toBe(false);
  });
});

describe("testVersion", () => {
  it("is the next patch version", () => {
    expect(testVersion("0.3.1")).toBe("0.3.2");
    expect(testVersion("1.2")).toBe("1.2.1");
    expect(testVersion("2")).toBe("2.0.1");
  });
});

describe("testDownloadEvents", () => {
  it("starts with the size, then chunks adding up to it, then finishes", () => {
    const events = testDownloadEvents(100, 3);
    expect(events[0]).toEqual({ event: "Started", data: { contentLength: 100 } });
    expect(events[events.length - 1]).toEqual({ event: "Finished" });
    const chunks = events.flatMap((e) => (e.event === "Progress" ? [e.data.chunkLength] : []));
    expect(chunks).toEqual([33, 33, 34]);
  });
});
