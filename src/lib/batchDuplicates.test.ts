import { describe, expect, it } from "vitest";
import { item, queue, stateOf } from "../test/fixtures";
import {
  anyKnownDuplicate,
  batchDuplicates,
  choiceTitle,
  choose,
  dupHeading,
  dupStatus,
  dupText,
  duplicateView,
  findBatchDuplicate,
  groupDuplicates,
  planBatch,
  sharedChoice,
  syncPicks,
  tick,
  type BatchDuplicate,
  type BatchPicks,
} from "./batchDuplicates";

const movies = queue({ id: "qm", dir: "/h/Movies" });
const here = queue({ id: "qh", dir: "/h/Downloads" });
const state = stateOf(
  [movies, here],
  [
    item({ id: "a", queue_id: "qm", url: "https://x.com/a.mkv", file_name: "a.mkv", status: "completed" }),
    item({ id: "b", queue_id: "qh", url: "https://x.com/b.zip", file_name: "b.zip" }),
  ],
);
const none = new Set<string>();

describe("findBatchDuplicate", () => {
  it("finds a download of the same link, in any folder", () => {
    const d = findBatchDuplicate("https://x.com/a.mkv", null, "/h/Downloads", state, none);
    expect(d).toEqual({ kind: "download", existing: state.downloads.a });
    expect(findBatchDuplicate("https://x.com/b.zip", null, "/h/Downloads", state, none)).toMatchObject({
      existing: { id: "b" },
    });
  });

  it("finds one by file name once it's known, ignoring copy numbers", () => {
    expect(findBatchDuplicate("https://cdn.com/signed?1", null, "/h/Downloads", state, none)).toBeNull();
    expect(findBatchDuplicate("https://cdn.com/signed?1", "a (1).mkv", "/h/Downloads", state, none)).toMatchObject({
      existing: { id: "a" },
    });
  });

  it("finds a file in the folder with the name it would get", () => {
    expect(findBatchDuplicate("https://y.com/c.pdf", "c.pdf", "/h/Downloads", state, new Set(["c.pdf"]))).toEqual({
      kind: "file",
      name: "c.pdf",
    });
    expect(findBatchDuplicate("https://y.com/c.pdf", "c.pdf", "/h/Downloads", state, none)).toBeNull();
  });

  it("checks a whole batch from what the server said", () => {
    const found = batchDuplicates(
      ["https://x.com/a.mkv", "https://y.com/new.iso", "https://y.com/c"],
      { "https://y.com/new.iso": { file_name: "new.iso", total_bytes: 1, original_name: null }, "https://y.com/c": null },
      "/h/Downloads",
      state,
      none,
    );
    expect(Object.keys(found)).toEqual(["https://x.com/a.mkv"]);
  });

  it("tells whether a paste has a known duplicate without asking the server", () => {
    expect(anyKnownDuplicate(["https://y.com/new", "https://x.com/a.mkv"], "/h/Downloads", state)).toBe(true);
    expect(anyKnownDuplicate(["https://y.com/new"], "/h/Downloads", state)).toBe(false);
  });
});

const elsewhere: BatchDuplicate = { kind: "download", existing: state.downloads.a };
const inHere: BatchDuplicate = { kind: "download", existing: state.downloads.b };
const file: BatchDuplicate = { kind: "file", name: "c.pdf" };

describe("choices", () => {
  it("says what each does", () => {
    expect(choiceTitle("both", elsewhere, "~/Downloads", "~/Movies")).toBe("Download it again into ~/Downloads/");
    expect(choiceTitle("replace", elsewhere, "~/Downloads", "~/Movies")).toBe(
      "Remove it from ~/Movies/ and download it again here",
    );
    expect(choiceTitle("replace", file, "~/Downloads", "~/Downloads")).toBe(
      "Move the file to the Trash and download it again",
    );
  });

  it("describes where the duplicate is and how it's doing", () => {
    expect(dupText(elsewhere, "~/Movies")).toBe("In ~/Movies/ (downloaded)");
    expect(dupText(file, "~/Downloads")).toBe("In ~/Downloads/ (a file with this name)");
    expect(dupStatus({ ...state.downloads.b, status: "downloading", downloaded: 42, total_bytes: 100 })).toBe(
      "downloading, 42%",
    );
    expect(dupStatus({ ...state.downloads.b, status: "downloading", total_bytes: null })).toBe("downloading");
    expect(dupStatus({ ...state.downloads.b, status: "paused" })).toBe("paused");
    expect(dupHeading(1)).toBe("1 download already exists");
    expect(dupHeading(3)).toBe("3 downloads already exist");
  });
});

describe("picks", () => {
  const start: BatchPicks = { ticked: new Set(["d1", "d2", "n"]), choices: {} };

  it("skips and unticks links found to be duplicates, once", () => {
    const synced = syncPicks(start, ["d1", "d2"]);
    expect(synced.choices).toEqual({ d1: "skip", d2: "skip" });
    expect([...synced.ticked]).toEqual(["n"]);
    const chosen = choose(synced, ["d1"], "replace");
    expect(syncPicks(chosen, ["d1", "d2"])).toBe(chosen);
  });

  it("forgets the choice of a link that's no longer a duplicate", () => {
    const synced = syncPicks(syncPicks(start, ["d1"]), []);
    expect(synced.choices).toEqual({});
  });

  it("ticks a duplicate given anything but skip", () => {
    const picks = syncPicks(start, ["d1", "d2"]);
    const replaced = choose(picks, ["d1", "d2"], "replace");
    expect(replaced.ticked.has("d1") && replaced.ticked.has("d2")).toBe(true);
    expect(sharedChoice(["d1", "d2"], replaced.choices)).toBe("replace");
    const skipped = choose(replaced, ["d2"], "skip");
    expect(skipped.ticked.has("d2")).toBe(false);
    expect(sharedChoice(["d1", "d2"], skipped.choices)).toBeNull();
  });

  it("keeps both when a skipped duplicate is ticked, and skips it when unticked", () => {
    const picks = syncPicks(start, ["d1"]);
    expect(tick(picks, ["d1"], true).choices.d1).toBe("both");
    expect(tick(choose(picks, ["d1"], "replace"), ["d1"], true).choices.d1).toBe("replace");
    expect(tick(choose(picks, ["d1"], "both"), ["d1"], false).choices.d1).toBe("skip");
    expect(tick(picks, ["n"], false).choices).toEqual({ d1: "skip" });
  });

  it("shows duplicates first, each part in its order", () => {
    expect(groupDuplicates(["n1", "d1", "n2", "d2"], { d1: file, d2: file })).toEqual({
      dups: ["d1", "d2"],
      rest: ["n1", "n2"],
    });
  });
});

describe("planBatch", () => {
  it("carries out each ticked link's choice", () => {
    const dups = { a: elsewhere, b: inHere, c: file };
    const picks: BatchPicks = {
      ticked: new Set(["n1", "a", "b", "c", "n2"]),
      choices: { a: "both", b: "replace", c: "replace", s: "skip" },
    };
    expect(planBatch(["n1", "a", "b", "c", "s", "n2"], picks, dups, "/h/Downloads")).toEqual({
      add: ["n1", "n2"],
      again: ["a", "b", "c"],
      trash: { ids: ["b"], paths: ["/h/Downloads/c.pdf"] },
    });
  });

  it("leaves out unticked links and skipped duplicates", () => {
    const picks: BatchPicks = { ticked: new Set(["n2"]), choices: { a: "skip" } };
    expect(planBatch(["n1", "a", "n2"], picks, { a: elsewhere }, "/h")).toEqual({
      add: ["n2"],
      again: [],
      trash: { ids: [], paths: [] },
    });
  });
});

describe("duplicateView", () => {
  it("is nothing without duplicates", () => {
    expect(duplicateView([], {}, {}, "~/Downloads", () => "")).toBeNull();
  });

  it("heads the duplicates with a choice for all, and lines each up with its own", () => {
    const view = duplicateView(
      ["a", "c"],
      { a: elsewhere, c: file },
      { a: "skip", c: "skip" },
      "~/Downloads",
      (d) => (d === elsewhere ? "~/Movies" : "~/Downloads"),
    )!;
    expect(view.heading).toBe("2 downloads already exist");
    expect(view.choice).toBe("skip");
    expect(view.options.map((o) => o.label)).toEqual(["Skip", "Keep both", "Replace"]);
    expect(view.options[1].title).toBe("Keep both (all 2)");
    expect(view.rows.a.text).toBe("In ~/Movies/ (downloaded)");
    expect(view.rows.a.options.map((o) => o.choice)).toEqual(["skip", "both", "replace"]);
    expect(view.rows.c.options[2].title).toBe("Move the file to the Trash and download it again");
  });

  it("chooses nothing for all when the duplicates' choices differ", () => {
    const view = duplicateView(["a", "m"], { a: elsewhere, m: elsewhere }, { a: "replace", m: "both" }, "~/D", () => "~/M")!;
    expect(view.choice).toBeNull();
  });
});
