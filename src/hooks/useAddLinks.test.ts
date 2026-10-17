// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engine } from "../lib/engine";
import { item, queue, stateOf } from "../test/fixtures";
import { useAddLinks } from "./useAddLinks";

vi.mock("../lib/engine", () => ({
  engine: {
    addDownload: vi.fn(async (_dir: string, url: string) => `new:${url}`),
    fileNameFor: vi.fn(async (url: string) => url.split("/").pop()),
    fileExists: vi.fn(async () => false),
    resume: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
  },
}));

beforeEach(() => vi.clearAllMocks());

const DIR = "/home/q";
const existing = item({ id: "a", queue_id: "q", url: "https://example.com/a.zip", status: "completed" });
const state = stateOf([queue({ id: "q", dir: DIR })], [existing]);

const setup = () => {
  const select = vi.fn();
  const go = vi.fn();
  const setNotice = vi.fn();
  const hook = renderHook(() => useAddLinks({ state, cwd: DIR, select, go, setNotice }));
  return { ...hook, select, go, setNotice };
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
});
