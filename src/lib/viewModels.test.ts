import { describe, expect, it } from "vitest";
import { item, queue, stateOf } from "../test/fixtures";
import {
  displayName,
  fileVm,
  folderVm,
  nameFromUrl,
  overviewTree,
  pendingVm,
  queueForDir,
  searchResults,
  stats,
  type ViewMode,
} from "./viewModels";

const MB = 1024 * 1024;

describe("displayName", () => {
  it("prefers a pending rename, then the file name, then the link", () => {
    const base = item({ id: "a", queue_id: "q", url: "https://example.com/from-url.zip" });
    expect(displayName({ ...base, rename_to: "renamed.zip" })).toBe("renamed.zip");
    expect(displayName(base)).toBe("a.zip");
    expect(displayName({ ...base, file_name: null })).toBe("from-url.zip");
  });
});

describe("nameFromUrl", () => {
  it("gives the last part of the path, decoded", () => {
    expect(nameFromUrl("https://example.com/files/My%20File.zip?x=1")).toBe("My File.zip");
    expect(nameFromUrl("https://example.com/dir/")).toBe("dir");
  });

  it("falls back to the host, or the text itself", () => {
    expect(nameFromUrl("https://example.com/")).toBe("example.com");
    expect(nameFromUrl("not a url")).toBe("not a url");
  });
});

describe("pendingVm", () => {
  it("shows the server's name once known, else the link's", () => {
    expect(pendingVm("k", "https://example.com/a.iso", null, "Checking…")).toMatchObject({
      id: "k",
      name: "a.iso",
      kind: "disc",
      status: "Checking…",
      info: "https://example.com/a.iso",
      action: null,
      done: false,
    });
    expect(pendingVm("k", "https://example.com/a.iso", "b.zip", "").name).toBe("b.zip");
  });
});

describe("fileVm", () => {
  const q = queue({ id: "q", dir: "/home/q" });
  const vmOf = (
    overrides: Partial<Parameters<typeof item>[0]>,
    { paused = false, mode = "List" as ViewMode, present = null as Set<string> | null, speed = 0 } = {},
  ) => {
    const d = item({ id: "a", queue_id: "q", ...overrides });
    const target = { ...q, settings: { ...q.settings, paused } };
    const state = stateOf([target], [d]);
    state.speeds.a = speed;
    return fileVm(d, state.queues.q, state, mode, present);
  };

  it("shows a finished download as done, with its path", () => {
    expect(vmOf({ status: "completed", downloaded: 100 })).toMatchObject({
      status: "Done",
      done: true,
      missing: false,
      pct: 100,
      showBar: false,
      action: null,
      path: "/home/q/a.zip",
    });
  });

  it("shows a finished download's size in icon view", () => {
    expect(vmOf({ status: "completed", total_bytes: 5 * MB }, { mode: "Icons" }).status).toBe("5.0 MB");
  });

  it("marks a finished file missing when the listing doesn't have it", () => {
    const vm = vmOf({ status: "completed" }, { present: new Set(["other.zip"]) });
    expect(vm).toMatchObject({ status: "Missing", missing: true, nameColor: "var(--muted)" });
    expect(vmOf({ status: "completed" }, { present: new Set(["a.zip"]) }).missing).toBe(false);
    expect(vmOf({ status: "completed" }, { present: null }).missing).toBe(false);
  });

  it("shows progress, speed and time left while running", () => {
    const running = { status: "downloading" as const, total_bytes: 100 * MB, downloaded: 50 * MB };
    expect(vmOf(running, { speed: MB })).toMatchObject({
      status: "50% · 1.0 MB/s · 50s",
      active: true,
      action: "pause",
      actionLabel: "Pause",
      color: "var(--accent)",
    });
    expect(vmOf(running, { speed: MB, mode: "Icons" }).status).toBe("50% · 50s left");
  });

  it("shows what's downloaded when the size is unknown", () => {
    const vm = vmOf({ status: "downloading", total_bytes: null, downloaded: 2 * MB }, { speed: MB });
    expect(vm.status).toBe("2.0 MB · 1.0 MB/s");
    expect(vm.size).toBe(2 * MB);
    expect(vm.sizeLabel).toBe("2.0 MB");
  });

  it("numbers waiting downloads in queue order", () => {
    const state = stateOf(
      [q],
      [
        item({ id: "x", queue_id: "q", status: "downloading" }),
        item({ id: "y", queue_id: "q", status: "queued" }),
        item({ id: "z", queue_id: "q", status: "queued" }),
      ],
    );
    expect(fileVm(state.downloads.z, state.queues.q, state, "List", null).status).toBe("Queued #2");
  });

  it("offers to resume a download waiting in a paused queue", () => {
    expect(vmOf({ status: "queued", downloaded: 40 }, { paused: true })).toMatchObject({
      status: "40%",
      action: "resume",
    });
  });

  it("offers to resume a paused download", () => {
    expect(vmOf({ status: "paused", downloaded: 40 })).toMatchObject({
      status: "Paused · 40%",
      action: "resume",
      actionLabel: "Resume",
    });
  });

  it("offers to retry a failed download, with its error", () => {
    const vm = vmOf({ status: "failed", downloaded: 40, error: "timed out" });
    expect(vm).toMatchObject({
      status: "Failed at 40%",
      action: "retry",
      actionLabel: "Retry",
      color: "var(--danger)",
      nameColor: "var(--danger)",
    });
    expect(vm.info).toContain("timed out");
  });

  it("has no size or path before anything is known", () => {
    expect(vmOf({ total_bytes: null, downloaded: 0, file_name: null })).toMatchObject({
      size: null,
      sizeLabel: "—",
      path: null,
    });
  });
});

describe("stats", () => {
  const state = stateOf(
    [queue({ id: "top", dir: "/h" }), queue({ id: "sub", dir: "/h/sub" })],
    [
      item({ id: "a", queue_id: "top", status: "downloading", total_bytes: 100, downloaded: 50 }),
      item({ id: "b", queue_id: "top", status: "completed", total_bytes: 100, downloaded: 100 }),
      item({ id: "c", queue_id: "sub", status: "queued", total_bytes: 200, downloaded: 0 }),
    ],
  );
  state.speeds.a = 10;

  it("counts the queue at the folder", () => {
    expect(stats(state, "/h", false)).toEqual({
      total: 200,
      pct: 75,
      active: 1,
      queued: 0,
      done: 1,
      speed: 10,
      pending: 1,
    });
  });

  it("counts every queue under the folder when deep", () => {
    expect(stats(state, "/h", true)).toMatchObject({ total: 400, pct: 37.5, queued: 1, pending: 2 });
  });

  it("is all zero for a folder without downloads", () => {
    expect(stats(state, "/elsewhere", true)).toMatchObject({ total: 0, pct: 0, active: 0, pending: 0 });
  });
});

describe("queueForDir", () => {
  it("finds the queue for exactly that folder", () => {
    const state = stateOf([queue({ id: "q", dir: "/h/q" })]);
    expect(queueForDir(state, "/h/q")?.id).toBe("q");
    expect(queueForDir(state, "/h")).toBeUndefined();
  });
});

describe("folderVm", () => {
  it("summarizes the downloads in and under the folder", () => {
    const state = stateOf(
      [queue({ id: "q", dir: "/h/a/q" })],
      [item({ id: "x", queue_id: "q", status: "downloading", total_bytes: 2 * MB, downloaded: MB })],
    );
    state.speeds.x = MB;
    expect(folderVm(state, "/h/a")).toMatchObject({
      name: "a",
      path: "/h/a",
      sub: "1 ↓ · 1.0 MB/s",
      sizeLabel: "2.0 MB",
      active: 1,
      paused: false,
      showBar: true,
      pct: 50,
      barColor: "var(--accent)",
      hasQueue: true,
    });
  });

  it("shows its own paused queue as paused, with nothing active", () => {
    const state = stateOf(
      [queue({ id: "q", dir: "/h/q", settings: { max_concurrent: 2, paused: true } })],
      [item({ id: "x", queue_id: "q", status: "downloading" })],
    );
    expect(folderVm(state, "/h/q")).toMatchObject({ paused: true, active: 0 });
  });

  it("isn't paused when its paused queue has nothing left", () => {
    const state = stateOf(
      [queue({ id: "q", dir: "/h/q", settings: { max_concurrent: 2, paused: true } })],
      [item({ id: "x", queue_id: "q", status: "completed" })],
    );
    expect(folderVm(state, "/h/q")).toMatchObject({ paused: false, showBar: false });
  });

  it("has no queue or size for a plain folder", () => {
    expect(folderVm(stateOf([]), "/h/plain")).toMatchObject({ hasQueue: false, sizeLabel: "—", sub: "" });
  });
});

describe("searchResults", () => {
  const home = "/h";
  const state = stateOf(
    [queue({ id: "lin", dir: "/h/Linux/Ubuntu" }), queue({ id: "mus", dir: "/h/Music" })],
    [
      item({ id: "u", queue_id: "lin", file_name: "ubuntu-desktop.iso" }),
      item({ id: "s", queue_id: "lin", file_name: "ubuntu-server.iso" }),
      item({ id: "m", queue_id: "mus", file_name: "song.mp3" }),
    ],
  );
  const listed = { dir: "/h", folders: ["Linux", "Music", "Ubuntu Notes"], present: new Set<string>() };
  const names = (r: { folders: { path: string }[]; files: { name: string }[] }) => ({
    folders: r.folders.map((f) => f.path),
    files: r.files.map((f) => f.name),
  });

  it("finds downloads and folders whose names have every word, ignoring case", () => {
    expect(names(searchResults(state, null, listed, home, "UBUNTU", "List"))).toEqual({
      folders: ["/h/Linux/Ubuntu", "/h/Ubuntu Notes"],
      files: ["ubuntu-desktop.iso", "ubuntu-server.iso"],
    });
    expect(names(searchResults(state, null, listed, home, "ubuntu server", "List")).files).toEqual([
      "ubuntu-server.iso",
    ]);
  });

  it("searches folders on the way to queues", () => {
    expect(names(searchResults(state, null, listed, home, "linux", "List")).folders).toEqual(["/h/Linux"]);
  });

  it("limits the search to queues under the root", () => {
    expect(names(searchResults(state, "/h/Music", listed, home, "u", "List")).files).toEqual([]);
    expect(names(searchResults(state, "/h/Music", listed, home, "song", "List")).files).toEqual(["song.mp3"]);
  });
});

describe("overviewTree", () => {
  const home = "/h";
  const running = (id: string, queue_id: string) => item({ id, queue_id, status: "downloading" });

  it("lists only queues with something running", () => {
    const state = stateOf(
      [queue({ id: "a", dir: "/h/a" }), queue({ id: "b", dir: "/h/b" })],
      [running("x", "a"), item({ id: "y", queue_id: "b", status: "queued" })],
    );
    expect(overviewTree(state, home).map((n) => n.id)).toEqual(["a"]);
  });

  it("nests a queue under the nearest listed queue above it", () => {
    const state = stateOf(
      [queue({ id: "top", dir: "/h/a" }), queue({ id: "deep", dir: "/h/a/b/c" }), queue({ id: "other", dir: "/h/z" })],
      [running("x", "top"), running("y", "deep"), running("z", "other")],
    );
    const tree = overviewTree(state, home);
    expect(tree.map((n) => n.id)).toEqual(["top", "other"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["deep"]);
  });

  it("doesn't nest siblings that share a prefix", () => {
    const state = stateOf(
      [queue({ id: "ab", dir: "/h/a-b" }), queue({ id: "a", dir: "/h/a" }), queue({ id: "inner", dir: "/h/a/c" })],
      [running("x", "ab"), running("y", "a"), running("z", "inner")],
    );
    const tree = overviewTree(state, home);
    expect(tree.map((n) => n.id)).toEqual(["a", "ab"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["inner"]);
  });

  it("labels the home queue Home and totals waiting downloads and speed", () => {
    const state = stateOf(
      [queue({ id: "home", dir: "/h", settings: { max_concurrent: 1, paused: true } })],
      [running("x", "home"), running("y", "home"), item({ id: "w", queue_id: "home", status: "queued" })],
    );
    state.speeds.x = 10;
    state.speeds.y = 5;
    expect(overviewTree(state, home)[0]).toMatchObject({
      label: "Home",
      paused: true,
      waiting: 1,
      speed: 15,
    });
    expect(overviewTree(state, home)[0].files.map((f) => f.id)).toEqual(["x", "y"]);
  });
});
