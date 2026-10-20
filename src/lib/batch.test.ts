import { describe, expect, it } from "vitest";
import {
  chosen,
  clickSelect,
  moveTo,
  nameCell,
  selectAllState,
  sizeCell,
  syncOrder,
  syncSelected,
  tickTargets,
  totalLabel,
} from "./batch";

const MB = 1024 * 1024;

describe("syncOrder", () => {
  it("keeps the user's order, dropping links that left and adding new ones at the end", () => {
    expect(syncOrder(["c", "a", "b"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
    expect(syncOrder(["c", "a", "b"], ["a", "c"])).toEqual(["c", "a"]);
  });

  it("returns the same order when nothing changed", () => {
    const order = ["b", "a"];
    expect(syncOrder(order, ["a", "b"])).toBe(order);
  });
});

describe("syncSelected", () => {
  it("ticks new links and drops those that left, keeping the user's choices", () => {
    const next = syncSelected(new Set(["a"]), ["a", "b"], ["a", "b", "c"]);
    expect([...next].sort()).toEqual(["a", "c"]);
    expect([...syncSelected(new Set(["a", "b"]), ["a", "b"], ["b"])]).toEqual(["b"]);
  });

  it("returns the same set when nothing changed", () => {
    const selected = new Set(["a"]);
    expect(syncSelected(selected, ["a", "b"], ["a", "b"])).toBe(selected);
  });
});

describe("moveTo", () => {
  it("moves a link to before the one at an index", () => {
    expect(moveTo(["a", "b", "c", "d"], ["d"], 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveTo(["a", "b", "c", "d"], ["a"], 3)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a link to the end", () => {
    expect(moveTo(["a", "b", "c"], ["a"], 3)).toEqual(["b", "c", "a"]);
  });

  it("leaves a link dropped on its own place where it is", () => {
    expect(moveTo(["a", "b", "c"], ["b"], 1)).toEqual(["a", "b", "c"]);
    expect(moveTo(["a", "b", "c"], ["b"], 2)).toEqual(["a", "b", "c"]);
  });

  it("moves several links together, keeping their order", () => {
    expect(moveTo(["a", "b", "c", "d", "e"], ["d", "b"], 0)).toEqual(["b", "d", "a", "c", "e"]);
    expect(moveTo(["a", "b", "c", "d", "e"], ["a", "c"], 5)).toEqual(["b", "d", "e", "a", "c"]);
  });
});

describe("clickSelect", () => {
  const order = ["a", "b", "c", "d"];
  const plain = { toggle: false, range: false };

  it("selects just the clicked row", () => {
    expect(clickSelect(order, new Set(["a"]), "a", "c", plain)).toEqual({ selection: new Set(["c"]), anchor: "c" });
  });

  it("keeps the selection when pressing a selected row, so it can be dragged", () => {
    const selection = new Set(["a", "c"]);
    expect(clickSelect(order, selection, "a", "c", plain).selection).toBe(selection);
  });

  it("adds or removes a row with Command", () => {
    const toggle = { toggle: true, range: false };
    expect(clickSelect(order, new Set(["a"]), "a", "c", toggle).selection).toEqual(new Set(["a", "c"]));
    expect(clickSelect(order, new Set(["a", "c"]), "a", "c", toggle).selection).toEqual(new Set(["a"]));
  });

  it("selects the range from the anchor with Shift, either way", () => {
    const range = { toggle: false, range: true };
    expect(clickSelect(order, new Set(["b"]), "b", "d", range)).toEqual({ selection: new Set(["b", "c", "d"]), anchor: "b" });
    expect(clickSelect(order, new Set(["c"]), "c", "a", range).selection).toEqual(new Set(["a", "b", "c"]));
  });

  it("treats Shift without an anchor as a plain click", () => {
    expect(clickSelect(order, new Set(), null, "b", { toggle: false, range: true }).selection).toEqual(new Set(["b"]));
  });
});

describe("tickTargets", () => {
  it("applies to the selected rows when the row is one of them", () => {
    expect(tickTargets(["a", "b", "c"], new Set(["c", "a"]), "c")).toEqual(["a", "c"]);
  });

  it("applies to just the row otherwise", () => {
    expect(tickTargets(["a", "b", "c"], new Set(["a"]), "b")).toEqual(["b"]);
  });
});

describe("selectAllState", () => {
  it("is ticked, mixed or clear", () => {
    expect(selectAllState(["a", "b"], new Set(["a", "b"]))).toBe(true);
    expect(selectAllState(["a", "b"], new Set(["b"]))).toBe("indeterminate");
    expect(selectAllState(["a", "b"], new Set())).toBe(false);
  });
});

describe("chosen", () => {
  it("lists the ticked links in queue order", () => {
    expect(chosen(["c", "a", "b"], new Set(["a", "c"]))).toEqual(["c", "a"]);
  });
});

describe("totalLabel", () => {
  const info = (total_bytes: number | null) => ({ file_name: "f", total_bytes });

  it("adds up the sizes", () => {
    expect(totalLabel(["a", "b"], { a: info(10 * MB), b: info(20 * MB) })).toBe("30 MB");
  });

  it("says when sizes are still being fetched", () => {
    expect(totalLabel(["a", "b"], {})).toBe("Fetching sizes…");
    expect(totalLabel(["a", "b"], { a: info(10 * MB) })).toBe("10 MB so far");
  });

  it("counts links the server gave no size for", () => {
    expect(totalLabel(["a", "b", "c"], { a: info(10 * MB), b: info(null), c: null })).toBe("10 MB + 2 unknown");
    expect(totalLabel(["a"], { a: null })).toBe("Size unknown");
  });

  it("says when nothing is ticked", () => {
    expect(totalLabel([], {})).toBe("Nothing selected");
  });
});

describe("nameCell", () => {
  const url = "https://example.com/files/a%20b.zip?sig=1";

  it("shows a placeholder while the server is asked", () => {
    expect(nameCell(url, undefined)).toEqual({ text: "Fetching…", fetching: true });
  });

  it("shows the server's name, else the name in the link", () => {
    expect(nameCell(url, { file_name: "report.zip", total_bytes: null })).toEqual({ text: "report.zip", fetching: false });
    expect(nameCell(url, null)).toEqual({ text: "a b.zip", fetching: false });
  });
});

describe("sizeCell", () => {
  it("is blank while asked, a dash when unknown, else the size", () => {
    expect(sizeCell(undefined)).toBe("");
    expect(sizeCell(null)).toBe("—");
    expect(sizeCell({ file_name: "f", total_bytes: null })).toBe("—");
    expect(sizeCell({ file_name: "f", total_bytes: 20 * MB })).toBe("20 MB");
  });
});
