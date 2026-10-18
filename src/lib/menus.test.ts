import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineState } from "../hooks/useEngine";
import { item, queue, stateOf } from "../test/fixtures";
import { engine, type DownloadItem } from "./engine";
import { backgroundMenu, downloadMenu, folderMenu, menuItems, selectionMenu, type MenuContext, type MenuItem } from "./menus";
import { fileVm, folderVm } from "./viewModels";

vi.mock("./engine", () => ({
  engine: {
    clearCompleted: vi.fn(async () => 0),
    openPath: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    readClipboard: vi.fn(async () => "https://example.com/x.zip"),
    remove: vi.fn(async () => {}),
    requeue: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
    setQueueSettings: vi.fn(async () => {}),
  },
}));

beforeEach(() => vi.clearAllMocks());

const CWD = "/home/q";
const SUB = "/home/q/sub";

/** A context for the folder `CWD`, whose queue holds `items`, with a subfolder `SUB` that has its own queue. */
function contextFor(items: DownloadItem[], overrides: Partial<MenuContext> = {}, paused = false): MenuContext {
  const state: EngineState = stateOf(
    [
      queue({ id: "q", dir: CWD, settings: { max_concurrent: 2, paused } }),
      queue({ id: "sub", dir: SUB }),
    ],
    items,
  );
  const files = state.queues.q.downloads.map((id) => fileVm(state.downloads[id], state.queues.q, state, "List", null));
  return {
    state,
    cwd: CWD,
    queue: state.queues.q,
    summary: "",
    doneHere: items.filter((d) => d.status === "completed").length,
    clip: null,
    pasteMode: "ask",
    query: "",
    selection: [],
    selected: new Set(),
    folders: [folderVm(state, SUB)],
    files,
    selectedFiles: [],
    select: vi.fn(),
    go: vi.fn(),
    startAdding: vi.fn(),
    pasteItems: vi.fn(),
    pasteLinks: vi.fn(),
    newQueue: vi.fn(),
    setPasteMode: vi.fn(),
    openQueuePanel: vi.fn(),
    onOpenFile: vi.fn(),
    pauseDownloads: vi.fn(),
    showInFolder: vi.fn(),
    diskPath: vi.fn((key: string) => (key.startsWith("/") ? key : CWD)),
    clipItems: vi.fn(),
    trashItems: vi.fn(),
    setEditing: vi.fn(),
    ...overrides,
  };
}

type Action = Extract<MenuItem, { kind: "action" }>;
const labels = (items: MenuItem[]) => items.flatMap((i) => (i.kind === "separator" ? [] : [i.label]));
const find = (items: MenuItem[], label: string) => {
  const found = items.find((i): i is Action => i.kind === "action" && i.label === label);
  if (!found) throw new Error(`No "${label}" in ${JSON.stringify(labels(items))}`);
  return found;
};

describe("menuItems", () => {
  const ctx = contextFor([item({ id: "a", queue_id: "q" }), item({ id: "b", queue_id: "q" })]);

  it("shows the background menu for empty space", () => {
    expect(labels(menuItems(ctx, null))).toContain("Add download…");
  });

  it("shows the selection menu for an item in a selection of several", () => {
    const several = { ...ctx, selection: ["a", "b"], selected: new Set(["a", "b"]) };
    expect(labels(menuItems(several, "a"))[0]).toBe("2 items selected");
  });

  it("shows an item's own menu when it's outside the selection", () => {
    const several = { ...ctx, selection: [SUB, "b"], selected: new Set([SUB, "b"]) };
    expect(labels(menuItems(several, "a"))).toContain("Pause");
  });

  it("shows the folder menu for a folder", () => {
    expect(labels(menuItems(ctx, SUB))[0]).toBe("Open");
  });

  it("shows nothing for an item that's gone from view", () => {
    expect(menuItems(ctx, "gone")).toEqual([]);
  });
});

describe("backgroundMenu", () => {
  it("leaves out the queue's items in a folder without a queue", () => {
    const ctx = { ...contextFor([]), queue: undefined };
    const items = backgroundMenu(ctx);
    expect(items[0]).toMatchObject({ kind: "action", label: "Add download…" });
    expect(labels(items)).not.toContain("Clear done");
  });

  it("heads the menu with the queue's status, or 'Queue'", () => {
    expect(backgroundMenu(contextFor([]))[0]).toEqual({ kind: "header", label: "Queue" });
    expect(backgroundMenu(contextFor([], { summary: "2 waiting" }))[0]).toEqual({ kind: "header", label: "2 waiting" });
  });

  it("offers pasting cut or copied items only when there are some", () => {
    expect(labels(backgroundMenu(contextFor([])))).not.toContain("Paste 2 items");
    const ctx = contextFor([], { clip: { keys: ["a", "b"], cut: false } });
    find(backgroundMenu(ctx), "Paste 2 items").onSelect();
    expect(ctx.pasteItems).toHaveBeenCalledWith(CWD);
  });

  it("pastes links from the clipboard", async () => {
    const ctx = contextFor([]);
    find(backgroundMenu(ctx), "Paste link").onSelect();
    await vi.waitFor(() => expect(ctx.pasteLinks).toHaveBeenCalledWith("https://example.com/x.zip"));
  });

  it("toggles asking before adding pasted links", () => {
    const ctx = contextFor([]);
    const ask = find(backgroundMenu(ctx), "Ask before adding pasted links");
    expect(ask.checked).toBe(true);
    ask.onSelect();
    expect(ctx.setPasteMode).toHaveBeenCalledWith("always");
  });

  it("pauses a running queue, and only when it has work", () => {
    const idle = find(backgroundMenu(contextFor([item({ id: "a", queue_id: "q", status: "completed" })])), "Pause queue");
    expect(idle.disabled).toBe(true);
    const busy = find(backgroundMenu(contextFor([item({ id: "a", queue_id: "q" })])), "Pause queue");
    expect(busy.disabled).toBe(false);
    busy.onSelect();
    expect(engine.setQueueSettings).toHaveBeenCalledWith("q", { max_concurrent: 2, paused: true });
  });

  it("resumes a paused queue", () => {
    find(backgroundMenu(contextFor([item({ id: "a", queue_id: "q" })], {}, true)), "Resume queue").onSelect();
    expect(engine.setQueueSettings).toHaveBeenCalledWith("q", { max_concurrent: 2, paused: false });
  });

  it("sets how many downloads run at a time", () => {
    const stepper = backgroundMenu(contextFor([])).find((i) => i.kind === "stepper");
    expect(stepper).toMatchObject({ value: 2, min: 1, max: 6 });
    if (stepper?.kind === "stepper") stepper.onChange(4);
    expect(engine.setQueueSettings).toHaveBeenCalledWith("q", { max_concurrent: 4, paused: false });
  });

  it("clears finished downloads only when there are some", () => {
    expect(find(backgroundMenu(contextFor([])), "Clear done").disabled).toBe(true);
    const clear = find(backgroundMenu(contextFor([item({ id: "a", queue_id: "q", status: "completed" })])), "Clear done");
    expect(clear.disabled).toBe(false);
    clear.onSelect();
    expect(engine.clearCompleted).toHaveBeenCalledWith("q");
  });
});

describe("downloadMenu", () => {
  const menuFor = (d: DownloadItem, overrides: Partial<MenuContext> = {}, paused = false) => {
    const ctx = contextFor([d], overrides, paused);
    return { ctx, items: downloadMenu(ctx, ctx.files[0]) };
  };

  it("opens and removes finished downloads", () => {
    const { ctx, items } = menuFor(item({ id: "a", queue_id: "q", status: "completed" }));
    expect(labels(items)).not.toContain("Pause");
    find(items, "Open").onSelect();
    expect(ctx.onOpenFile).toHaveBeenCalledWith(ctx.files[0]);
    find(items, "Remove from list").onSelect();
    expect(engine.remove).toHaveBeenCalledWith("a");
    expect(ctx.select).toHaveBeenCalledWith([]);
  });

  it("can't open a finished download without a file", () => {
    const { items } = menuFor(item({ id: "a", queue_id: "q", status: "completed", file_name: null }));
    expect(find(items, "Open").disabled).toBe(true);
  });

  it("pauses running and waiting downloads, which can't be removed from the list", () => {
    for (const status of ["downloading", "queued"] as const) {
      const { ctx, items } = menuFor(item({ id: "a", queue_id: "q", status }));
      expect(labels(items)).not.toContain("Resume");
      expect(labels(items)).not.toContain("Remove from list");
      find(items, "Pause").onSelect();
      expect(ctx.pauseDownloads).toHaveBeenCalledWith(["a"]);
    }
  });

  it("starts a download waiting in a paused queue on its own", () => {
    const { items } = menuFor(item({ id: "a", queue_id: "q", status: "queued" }), {}, true);
    expect(labels(items)).toContain("Pause");
    find(items, "Resume").onSelect();
    expect(engine.resume).toHaveBeenCalledWith("a");
  });

  it("resumes paused downloads and retries failed ones", () => {
    find(menuFor(item({ id: "a", queue_id: "q", status: "paused" })).items, "Resume").onSelect();
    find(menuFor(item({ id: "b", queue_id: "q", status: "failed" })).items, "Retry").onSelect();
    expect(engine.resume).toHaveBeenCalledWith("a");
    expect(engine.resume).toHaveBeenCalledWith("b");
  });

  it("shows a search result in its folder", () => {
    const { ctx, items } = menuFor(item({ id: "a", queue_id: "q" }), { query: "a" });
    find(items, "Show in Enclosing Folder").onSelect();
    expect(ctx.showInFolder).toHaveBeenCalledWith("a");
    expect(labels(menuFor(item({ id: "a", queue_id: "q" })).items)).not.toContain("Show in Enclosing Folder");
  });

  it("renames, cuts, copies and trashes", () => {
    const { ctx, items } = menuFor(item({ id: "a", queue_id: "q" }));
    find(items, "Rename").onSelect();
    expect(ctx.setEditing).toHaveBeenCalledWith("a");
    find(items, "Cut").onSelect();
    expect(ctx.clipItems).toHaveBeenCalledWith(["a"], true);
    find(items, "Copy").onSelect();
    expect(ctx.clipItems).toHaveBeenCalledWith(["a"], false);
    find(items, "Move to Trash").onSelect();
    expect(ctx.trashItems).toHaveBeenCalledWith(["a"]);
  });
});

describe("selectionMenu", () => {
  const select = (ctx: MenuContext, keys: string[]): MenuContext => ({
    ...ctx,
    selection: keys,
    selected: new Set(keys),
    selectedFiles: ctx.files.filter((f) => keys.includes(f.id)),
  });

  it("offers only showing, clipping and trashing for folders", () => {
    const ctx = select(contextFor([]), [SUB, "/home/q/other"]);
    const items = selectionMenu(ctx);
    expect(labels(items)).toEqual(["2 items selected", "Show in File Manager", "Cut", "Copy", "Move 2 items to Trash"]);
    find(items, "Move 2 items to Trash").onSelect();
    expect(ctx.trashItems).toHaveBeenCalledWith([SUB, "/home/q/other"]);
  });

  it("shows each folder once in the file manager", () => {
    const ctx = select(contextFor([item({ id: "a", queue_id: "q" }), item({ id: "b", queue_id: "q" })]), ["a", "b"]);
    find(selectionMenu(ctx), "Show in File Manager").onSelect();
    expect(engine.reveal).toHaveBeenCalledWith([CWD]);
  });

  it("pauses only the running and waiting downloads", () => {
    const ctx = select(
      contextFor([
        item({ id: "a", queue_id: "q", status: "downloading" }),
        item({ id: "b", queue_id: "q", status: "paused" }),
      ]),
      ["a", "b"],
    );
    find(selectionMenu(ctx), "Pause").onSelect();
    expect(ctx.pauseDownloads).toHaveBeenCalledWith(["a"]);
  });

  it("disables what doesn't apply", () => {
    const ctx = select(contextFor([item({ id: "a", queue_id: "q", status: "completed" })]), ["a", SUB]);
    expect(find(selectionMenu(ctx), "Pause").disabled).toBe(true);
    expect(find(selectionMenu(ctx), "Resume").disabled).toBe(true);
  });

  it("puts resumed downloads back in line in a running queue", () => {
    const ctx = select(
      contextFor([item({ id: "a", queue_id: "q", status: "paused" }), item({ id: "b", queue_id: "q", status: "failed" })]),
      ["a", "b"],
    );
    find(selectionMenu(ctx), "Resume").onSelect();
    expect(engine.requeue).toHaveBeenCalledWith(["a", "b"]);
    expect(engine.resume).not.toHaveBeenCalled();
  });

  it("starts resumed downloads on their own in a paused queue", () => {
    const ctx = select(
      contextFor(
        [item({ id: "a", queue_id: "q", status: "paused" }), item({ id: "b", queue_id: "q", status: "queued" })],
        {},
        true,
      ),
      ["a", "b"],
    );
    find(selectionMenu(ctx), "Resume").onSelect();
    expect(engine.resume).toHaveBeenCalledWith("a");
    expect(engine.resume).toHaveBeenCalledWith("b");
    expect(engine.requeue).not.toHaveBeenCalled();
  });

  it("removes only the finished downloads from the list", () => {
    const ctx = select(
      contextFor([item({ id: "a", queue_id: "q", status: "completed" }), item({ id: "b", queue_id: "q" })]),
      ["a", "b"],
    );
    find(selectionMenu(ctx), "Remove 1 finished download from list").onSelect();
    expect(engine.remove).toHaveBeenCalledExactlyOnceWith("a");
    expect(ctx.select).toHaveBeenCalledWith([]);
  });
});

describe("folderMenu", () => {
  it("opens the folder", () => {
    const ctx = contextFor([]);
    find(folderMenu(ctx, SUB), "Open").onSelect();
    expect(ctx.go).toHaveBeenCalledWith(SUB);
  });

  it("leaves out queue items for a folder without a queue", () => {
    const ctx = contextFor([]);
    const plain = "/home/q/plain";
    expect(labels(folderMenu({ ...ctx, folders: [folderVm(ctx.state, plain)] }, plain))).not.toContain(
      "Queue Settings…",
    );
  });

  it("opens the queue settings for the folder, selecting it", () => {
    const ctx = contextFor([]);
    find(folderMenu(ctx, SUB), "Queue Settings…").onSelect();
    expect(ctx.select).toHaveBeenCalledWith([SUB]);
    expect(ctx.openQueuePanel).toHaveBeenCalled();
  });

  it("disables pausing a queue with nothing to download", () => {
    expect(find(folderMenu(contextFor([]), SUB), "Pause queue").disabled).toBe(true);
  });

  it("pastes into the folder, unless it's one of the clipped items", () => {
    const ctx = contextFor([], { clip: { keys: ["a"], cut: true } });
    find(folderMenu(ctx, SUB), "Paste 1 item Into Folder").onSelect();
    expect(ctx.pasteItems).toHaveBeenCalledWith(SUB);
    const self = contextFor([], { clip: { keys: [SUB], cut: true } });
    expect(labels(folderMenu(self, SUB))).not.toContain("Paste 1 item Into Folder");
  });

  it("trashes the folder", () => {
    const ctx = contextFor([]);
    find(folderMenu(ctx, SUB), "Move to Trash").onSelect();
    expect(ctx.trashItems).toHaveBeenCalledWith([SUB]);
  });
});
