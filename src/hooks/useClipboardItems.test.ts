// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engine } from "../lib/engine";
import { fileVm } from "../lib/viewModels";
import { item, queue, stateOf } from "../test/fixtures";
import { useClipboardItems } from "./useClipboardItems";
import type { Undo } from "./useUndo";

vi.mock("../lib/engine", () => ({
  engine: {
    copyDownloads: vi.fn(async (ids: string[]) => ids.map((id) => `copy:${id}`)),
    copyFolders: vi.fn(async (paths: string[], dest: string) => paths.map((p) => `${dest}/${p.split("/").pop()} copy`)),
    moveDownloads: vi.fn(async () => {}),
    moveFolders: vi.fn(async () => {}),
    moveToTrash: vi.fn(async () => ({ downloads: [], folders: [], error: null })),
    readClipboard: vi.fn(async () => ""),
    writeClipboard: vi.fn(async () => {}),
  },
}));

beforeEach(() => vi.clearAllMocks());

const HERE = "/home/here";
const THERE = "/home/there";
const state = stateOf(
  [queue({ id: "here", dir: HERE }), queue({ id: "there", dir: THERE })],
  [
    item({ id: "done", queue_id: "here", status: "completed", file_name: "done.zip" }),
    item({ id: "running", queue_id: "here", status: "downloading", file_name: null, url: "https://example.com/r" }),
    item({ id: "away", queue_id: "there", status: "completed" }),
  ],
);
const files = state.queues.here.downloads.map((id) => fileVm(state.downloads[id], state.queues.here, state, "List", null));

function setup(cwd = HERE) {
  const options = {
    state,
    files,
    cwd,
    select: vi.fn(),
    setNotice: vi.fn(),
    refresh: vi.fn(),
    pushUndo: vi.fn<(undo: Undo) => void>(),
    pasteLinks: vi.fn(),
  };
  const hook = renderHook(() => useClipboardItems(options));
  return { ...hook, ...options };
}

/** The change pasting pushed for undo. */
const pushed = (pushUndo: ReturnType<typeof setup>["pushUndo"]) => pushUndo.mock.calls[0][0];

describe("clipItems", () => {
  it("clips the items and puts their paths, or links when unfinished, on the clipboard", () => {
    const { result } = setup();
    act(() => result.current.clipItems(["/home/here/sub", "done", "running"], false));
    expect(result.current.clip).toEqual({ keys: ["/home/here/sub", "done", "running"], cut: false });
    expect(engine.writeClipboard).toHaveBeenCalledWith("/home/here/sub\n/home/here/done.zip\nhttps://example.com/r");
  });

  it("does nothing with nothing to clip", () => {
    const { result } = setup();
    act(() => result.current.clipItems([], true));
    expect(result.current.clip).toBeNull();
    expect(engine.writeClipboard).not.toHaveBeenCalled();
  });
});

describe("pasteItems", () => {
  it("moves cut items, selects them here, and can move them back", async () => {
    const { result, select, pushUndo, refresh } = setup(THERE);
    act(() => result.current.clipItems(["done", "/home/here/sub"], true));
    act(() => result.current.pasteItems(THERE));
    // Cut items paste once.
    expect(result.current.clip).toBeNull();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(engine.moveDownloads).toHaveBeenCalledWith(["done"], THERE);
    expect(engine.moveFolders).toHaveBeenCalledWith(["/home/here/sub"], THERE);
    expect(select).toHaveBeenCalledWith(["/home/there/sub", "done"]);

    const undo = pushed(pushUndo);
    vi.clearAllMocks();
    expect(undo.label).toBe("Move");
    await undo.run();
    expect(engine.moveDownloads).toHaveBeenCalledWith(["done"], HERE);
    expect(engine.moveFolders).toHaveBeenCalledWith(["/home/there/sub"], HERE);
  });

  it("doesn't select pasted items in another folder", async () => {
    const { result, select, refresh } = setup(HERE);
    act(() => result.current.clipItems(["done"], true));
    act(() => result.current.pasteItems(THERE));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(select).not.toHaveBeenCalled();
  });

  it("has nothing to undo when cut items are pasted where they are", async () => {
    const { result, pushUndo, refresh } = setup();
    act(() => result.current.clipItems(["done", "/home/here/sub"], true));
    act(() => result.current.pasteItems(HERE));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(pushUndo).not.toHaveBeenCalled();
  });

  it("copies items, keeps them clipped, and undoes by trashing the copies", async () => {
    const { result, select, pushUndo, refresh } = setup(THERE);
    act(() => result.current.clipItems(["done", "/home/here/sub"], false));
    act(() => result.current.pasteItems(THERE));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(result.current.clip).not.toBeNull();
    expect(select).toHaveBeenCalledWith(["/home/there/sub copy", "copy:done"]);

    const undo = pushed(pushUndo);
    expect(undo.label).toBe("Copy");
    await undo.run();
    expect(engine.moveToTrash).toHaveBeenCalledWith(["copy:done"], ["/home/there/sub copy"]);
  });

  it("reports a failed paste", async () => {
    vi.mocked(engine.moveFolders).mockRejectedValueOnce("already exists there");
    const { result, setNotice, pushUndo, refresh } = setup();
    act(() => result.current.clipItems(["/home/here/sub"], true));
    act(() => result.current.pasteItems(THERE));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(setNotice).toHaveBeenCalledWith("Couldn't paste: already exists there");
    expect(pushUndo).not.toHaveBeenCalled();
  });
});

describe("paste", () => {
  it("pastes clipped items while the clipboard still holds them", async () => {
    vi.mocked(engine.readClipboard).mockResolvedValue("/home/here/done.zip");
    const { result, pasteLinks, refresh } = setup(THERE);
    act(() => result.current.clipItems(["done"], false));
    act(() => result.current.paste());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(engine.copyDownloads).toHaveBeenCalledWith(["done"], THERE);
    expect(pasteLinks).not.toHaveBeenCalled();
  });

  it("adds the links on the clipboard once something else was copied", async () => {
    vi.mocked(engine.readClipboard).mockResolvedValue("https://example.com/new.zip");
    const { result, pasteLinks } = setup();
    act(() => result.current.clipItems(["done"], false));
    act(() => result.current.paste());
    await waitFor(() => expect(pasteLinks).toHaveBeenCalledWith("https://example.com/new.zip"));
    expect(engine.copyDownloads).not.toHaveBeenCalled();
  });

  it("doesn't add the paths of items already pasted as links", async () => {
    vi.mocked(engine.readClipboard).mockResolvedValue("/home/here/done.zip");
    const { result, pasteLinks, refresh } = setup(THERE);
    act(() => result.current.clipItems(["done"], true));
    act(() => result.current.paste());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    act(() => result.current.paste());
    await waitFor(() => expect(engine.readClipboard).toHaveBeenCalledTimes(2));
    expect(pasteLinks).not.toHaveBeenCalled();
  });

  it("pastes clipped items when the clipboard couldn't be written or read", async () => {
    vi.mocked(engine.writeClipboard).mockRejectedValueOnce("denied");
    vi.mocked(engine.readClipboard).mockRejectedValue("no text");
    const { result, refresh } = setup(THERE);
    act(() => result.current.clipItems(["done"], false));
    await waitFor(() => expect(engine.writeClipboard).toHaveBeenCalled());
    act(() => result.current.paste());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(engine.copyDownloads).toHaveBeenCalledWith(["done"], THERE);
  });

  it("does nothing before a folder is open", async () => {
    const { result } = setup(null as unknown as string);
    act(() => result.current.paste());
    expect(engine.readClipboard).not.toHaveBeenCalled();
  });
});
