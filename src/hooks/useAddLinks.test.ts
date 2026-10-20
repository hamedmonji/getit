// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engine } from "../lib/engine";
import { clearProbes } from "../lib/probes";
import { item, queue, stateOf } from "../test/fixtures";
import { useAddLinks } from "./useAddLinks";

vi.mock("../lib/engine", () => ({
  engine: {
    addDownload: vi.fn(async (_dir: string, url: string) => `new:${url}`),
    probeLink: vi.fn(async (url: string) => ({ file_name: url.split("/").pop(), total_bytes: null })),
    fileExists: vi.fn(async () => false),
    resume: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  clearProbes();
});

const DIR = "/home/q";
const existing = item({ id: "a", queue_id: "q", url: "https://example.com/a.zip", status: "completed" });
const state = stateOf([queue({ id: "q", dir: DIR })], [existing]);

const setup = () => {
  const select = vi.fn();
  const go = vi.fn();
  const setNotice = vi.fn();
  const recapture = vi.fn();
  const hook = renderHook(() => useAddLinks({ state, cwd: DIR, select, go, setNotice, recapture }));
  return { ...hook, select, go, setNotice, recapture };
};

describe("useAddLinks", () => {
  it("adds new links and selects them", async () => {
    const { result, select } = setup();
    await act(() => result.current.addLinks(["https://example.com/b.zip"]));
    expect(engine.addDownload).toHaveBeenCalledWith(DIR, "https://example.com/b.zip");
    expect(select).toHaveBeenCalledWith(["new:https://example.com/b.zip"]);
    expect(result.current.duplicates).toBeNull();
    expect(result.current.pendingAdds).toEqual([]);
  });

  it("asks about a link that's already a download, without adding it", async () => {
    const { result } = setup();
    await act(() => result.current.addLinks(["https://example.com/a.zip"]));
    expect(engine.addDownload).not.toHaveBeenCalled();
    expect(result.current.duplicates).toEqual({
      dir: DIR,
      items: [{ url: "https://example.com/a.zip", kind: "link", existing }],
    });
  });

  it("asks about a link whose file name a download already has", async () => {
    const { result } = setup();
    await act(() => result.current.addLinks(["https://cdn.example.com/signed/a.zip"]));
    expect(engine.addDownload).not.toHaveBeenCalled();
    expect(result.current.duplicates?.items).toMatchObject([{ kind: "name", existing }]);
    // Its temporary item stays while the user decides.
    expect(result.current.pendingAdds).toMatchObject([{ url: "https://cdn.example.com/signed/a.zip", name: "a.zip" }]);
  });

  it("asks once about a link added again while it's being asked about", async () => {
    const { result } = setup();
    await act(() => result.current.addLinks(["https://example.com/a.zip"]));
    await act(() => result.current.addLinks(["https://example.com/a.zip"]));
    expect(result.current.duplicates?.items).toHaveLength(1);
  });

  it("asks once about a name clash added again while it's being asked about", async () => {
    const { result } = setup();
    await act(() => result.current.addLinks(["https://cdn.example.com/signed/a.zip"]));
    await act(() => result.current.addLinks(["https://cdn.example.com/signed/a.zip"]));
    expect(result.current.duplicates?.items).toHaveLength(1);
    expect(result.current.pendingAdds).toHaveLength(1);
  });

  it("skipping a duplicate drops it and its temporary item", async () => {
    const { result } = setup();
    await act(() => result.current.addLinks(["https://cdn.example.com/signed/a.zip"]));
    act(() => result.current.settleDuplicates(result.current.duplicates!.items, "skip"));
    expect(result.current.duplicates).toBeNull();
    expect(result.current.pendingAdds).toEqual([]);
  });

  it("adding a duplicate anyway adds it without checking", async () => {
    const { result } = setup();
    await act(() => result.current.addLinks(["https://example.com/a.zip"]));
    act(() => result.current.settleDuplicates(result.current.duplicates!.items, "add"));
    await waitFor(() => expect(engine.addDownload).toHaveBeenCalledWith(DIR, "https://example.com/a.zip"));
    expect(result.current.duplicates).toBeNull();
  });

  describe("checkCaptured", () => {
    it("asks at once about captured links that are already downloads, and passes on the rest", async () => {
      const { result } = setup();
      let checked!: ReturnType<typeof result.current.checkCaptured>;
      act(() => {
        checked = result.current.checkCaptured(["https://example.com/a.zip", "https://example.com/b.zip"], DIR);
      });
      expect(checked.fresh).toEqual(["https://example.com/b.zip"]);
      expect(result.current.duplicates).toEqual({
        dir: DIR,
        captured: true,
        items: [{ url: "https://example.com/a.zip", kind: "link", existing }],
      });
      await act(async () => expect(await checked.byName).toEqual([]));
      expect(engine.addDownload).not.toHaveBeenCalled();
    });

    it("asks about captured links whose file name a download already has, once the server names them", async () => {
      const { result } = setup();
      let checked!: ReturnType<typeof result.current.checkCaptured>;
      act(() => {
        checked = result.current.checkCaptured(["https://cdn.example.com/signed/a.zip"], DIR);
      });
      expect(checked.fresh).toEqual(["https://cdn.example.com/signed/a.zip"]);
      await act(async () => expect(await checked.byName).toEqual(["https://cdn.example.com/signed/a.zip"]));
      expect(result.current.duplicates).toMatchObject({ captured: true, items: [{ kind: "name", existing }] });
      expect(result.current.pendingAdds).toEqual([]);
    });

    it("leaves out captured links already being asked about", async () => {
      const { result } = setup();
      act(() => void result.current.checkCaptured(["https://example.com/a.zip"], DIR));
      let checked!: ReturnType<typeof result.current.checkCaptured>;
      act(() => {
        checked = result.current.checkCaptured(["https://example.com/a.zip"], DIR);
      });
      expect(checked.fresh).toEqual([]);
      expect(result.current.duplicates?.items).toHaveLength(1);
    });

    it("adding a captured duplicate anyway hands it back to wait for a folder", async () => {
      const { result, recapture } = setup();
      act(() => void result.current.checkCaptured(["https://example.com/a.zip"], DIR));
      act(() => result.current.settleDuplicates(result.current.duplicates!.items, "add"));
      expect(recapture).toHaveBeenCalledWith(["https://example.com/a.zip"]);
      expect(engine.addDownload).not.toHaveBeenCalled();
      expect(result.current.duplicates).toBeNull();
    });
  });
});
