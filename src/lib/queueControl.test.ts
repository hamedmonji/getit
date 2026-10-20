import { beforeEach, describe, expect, it, vi } from "vitest";
import { item, queue, stateOf } from "../test/fixtures";
import { engine } from "./engine";
import { hasWork, heldIn, isQueuePaused, pauseAll, pauseQueue, resumeQueue } from "./queueControl";

vi.mock("./engine", () => ({
  engine: {
    pause: vi.fn(async () => {}),
    requeue: vi.fn(async () => {}),
    setQueueSettings: vi.fn(async () => {}),
  },
}));

beforeEach(() => vi.clearAllMocks());

const q = queue({ id: "q", dir: "/home/q" });
const paused = queue({ id: "q", dir: "/home/q", settings: { max_concurrent: 2, paused: true, retries: 3, rename: [] } });

describe("heldIn", () => {
  it("lists the queue's downloads paused one by one, in queue order", () => {
    const state = stateOf(
      [q],
      [
        item({ id: "a", queue_id: "q", status: "paused" }),
        item({ id: "b", queue_id: "q", status: "downloading" }),
        item({ id: "c", queue_id: "q", status: "paused" }),
      ],
    );
    expect(heldIn(state, state.queues.q)).toEqual(["a", "c"]);
  });

  it("skips ids missing from the state", () => {
    const state = stateOf([{ ...q, downloads: ["gone"] }]);
    expect(heldIn(state, state.queues.q)).toEqual([]);
  });
});

describe("isQueuePaused", () => {
  it("is true for a queue paused in its settings", () => {
    const state = stateOf([paused], [item({ id: "a", queue_id: "q", status: "downloading" })]);
    expect(isQueuePaused(state, state.queues.q)).toBe(true);
  });

  it("is true when nothing runs or waits and some downloads were paused one by one", () => {
    const state = stateOf(
      [q],
      [item({ id: "a", queue_id: "q", status: "paused" }), item({ id: "b", queue_id: "q", status: "completed" })],
    );
    expect(isQueuePaused(state, state.queues.q)).toBe(true);
  });

  it("is false while a download runs or waits", () => {
    for (const status of ["downloading", "queued"] as const) {
      const state = stateOf(
        [q],
        [item({ id: "a", queue_id: "q", status: "paused" }), item({ id: "b", queue_id: "q", status })],
      );
      expect(isQueuePaused(state, state.queues.q)).toBe(false);
    }
  });

  it("is false for a running queue with nothing paused", () => {
    const state = stateOf([q], [item({ id: "a", queue_id: "q", status: "completed" })]);
    expect(isQueuePaused(state, state.queues.q)).toBe(false);
  });
});

describe("hasWork", () => {
  it("is true while any download is unfinished", () => {
    const state = stateOf(
      [q],
      [item({ id: "a", queue_id: "q", status: "completed" }), item({ id: "b", queue_id: "q", status: "failed" })],
    );
    expect(hasWork(state, state.queues.q)).toBe(true);
  });

  it("is false when everything is finished, or the queue is empty", () => {
    const done = stateOf([q], [item({ id: "a", queue_id: "q", status: "completed" })]);
    expect(hasWork(done, done.queues.q)).toBe(false);
    const empty = stateOf([q]);
    expect(hasWork(empty, empty.queues.q)).toBe(false);
  });
});

describe("resumeQueue", () => {
  it("unpauses a paused queue and puts held downloads back in line", async () => {
    const state = stateOf([paused], [item({ id: "a", queue_id: "q", status: "paused" })]);
    await resumeQueue(state, state.queues.q);
    expect(engine.setQueueSettings).toHaveBeenCalledWith("q", { max_concurrent: 2, paused: false, retries: 3, rename: [] });
    expect(engine.requeue).toHaveBeenCalledWith(["a"]);
  });

  it("only requeues when the queue isn't paused", async () => {
    const state = stateOf([q], [item({ id: "a", queue_id: "q", status: "paused" })]);
    await resumeQueue(state, state.queues.q);
    expect(engine.setQueueSettings).not.toHaveBeenCalled();
    expect(engine.requeue).toHaveBeenCalledWith(["a"]);
  });

  it("only unpauses when nothing is held", async () => {
    const state = stateOf([paused], [item({ id: "a", queue_id: "q", status: "queued" })]);
    await resumeQueue(state, state.queues.q);
    expect(engine.setQueueSettings).toHaveBeenCalledOnce();
    expect(engine.requeue).not.toHaveBeenCalled();
  });
});

describe("pauseQueue", () => {
  it("pauses a running queue in its settings", async () => {
    const state = stateOf([q], [item({ id: "a", queue_id: "q", status: "downloading" })]);
    await pauseQueue(state, state.queues.q);
    expect(engine.setQueueSettings).toHaveBeenCalledWith("q", { max_concurrent: 2, paused: true, retries: 3, rename: [] });
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it("in a paused queue, pauses the downloads started on their own", async () => {
    const state = stateOf(
      [paused],
      [item({ id: "a", queue_id: "q", status: "downloading" }), item({ id: "b", queue_id: "q", status: "queued" })],
    );
    await pauseQueue(state, state.queues.q);
    expect(engine.setQueueSettings).not.toHaveBeenCalled();
    expect(engine.pause).toHaveBeenCalledExactlyOnceWith("a");
  });
});

describe("pauseAll", () => {
  it("pauses only the queues with something running", async () => {
    const state = stateOf(
      [queue({ id: "q1", dir: "/1" }), queue({ id: "q2", dir: "/2" })],
      [item({ id: "a", queue_id: "q1", status: "downloading" }), item({ id: "b", queue_id: "q2", status: "queued" })],
    );
    await pauseAll(state);
    expect(engine.setQueueSettings).toHaveBeenCalledExactlyOnceWith("q1", { max_concurrent: 2, paused: true, retries: 3, rename: [] });
  });
});
