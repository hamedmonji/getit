// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useUndo } from "./useUndo";

const setup = () => {
  const onNotice = vi.fn();
  const onDone = vi.fn();
  const hook = renderHook(() => useUndo(onNotice, onDone));
  return { ...hook, onNotice, onDone };
};

const change = (label: string, run = vi.fn(async () => {})) => ({ label, run });

describe("useUndo", () => {
  it("undoes the newest change first", async () => {
    const { result, onDone } = setup();
    const first = change("first");
    const second = change("second");
    act(() => {
      result.current.push(first);
      result.current.push(second);
    });
    act(() => result.current.undo());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(second.run).toHaveBeenCalledOnce();
    expect(first.run).not.toHaveBeenCalled();
  });

  it("undoes each change once when pressed twice before re-rendering", async () => {
    const { result, onDone } = setup();
    const first = change("first");
    const second = change("second");
    act(() => {
      result.current.push(first);
      result.current.push(second);
    });
    act(() => {
      result.current.undo();
      result.current.undo();
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    expect(second.run).toHaveBeenCalledOnce();
    expect(first.run).toHaveBeenCalledOnce();
  });

  it("does nothing with nothing to undo", () => {
    const { result, onDone } = setup();
    act(() => result.current.undo());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("clears the notice when undoing works, and reports when it fails", async () => {
    const { result, onNotice, onDone } = setup();
    act(() => {
      result.current.push(change("fails", vi.fn(async () => Promise.reject("disk full"))));
      result.current.push(change("works"));
    });
    act(() => result.current.undo());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onNotice).toHaveBeenLastCalledWith(null);
    act(() => result.current.undo());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    expect(onNotice).toHaveBeenLastCalledWith("Couldn't undo: disk full");
  });

  it("keeps only the last 50 changes", async () => {
    const { result, onDone } = setup();
    const changes = Array.from({ length: 51 }, (_, i) => change(`change ${i}`));
    act(() => changes.forEach((c) => result.current.push(c)));
    act(() => {
      for (let i = 0; i < 51; i++) result.current.undo();
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(50));
    expect(changes[0].run).not.toHaveBeenCalled();
    expect(changes[1].run).toHaveBeenCalledOnce();
  });
});
