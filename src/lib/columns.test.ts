import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDTHS,
  MIN_WIDTHS,
  columnTemplate,
  columnsWidth,
  fitColumn,
  parseHiddenColumns,
  shownColumns,
  withColumnShown,
  parseColumnWidths,
  pinName,
  resetColumn,
  resizeColumn,
} from "./columns";

describe("resizeColumn", () => {
  it("sets the column's width in whole pixels, leaving the others", () => {
    expect(resizeColumn(DEFAULT_WIDTHS, "size", 101.6)).toEqual({ ...DEFAULT_WIDTHS, size: 102 });
  });

  it("stops at the column's minimum", () => {
    expect(resizeColumn(DEFAULT_WIDTHS, "status", 3).status).toBe(MIN_WIDTHS.status);
  });

  it("gives the filling name column a width of its own", () => {
    expect(resizeColumn(DEFAULT_WIDTHS, "name", 300).name).toBe(300);
  });
});

describe("pinName", () => {
  it("fixes a filling name column at its width on screen, rounded down", () => {
    expect(pinName(DEFAULT_WIDTHS, 412.7)).toEqual({ ...DEFAULT_WIDTHS, name: 412 });
  });

  it("leaves a name column that's already sized", () => {
    const widths = { ...DEFAULT_WIDTHS, name: 300 };
    expect(pinName(widths, 412)).toBe(widths);
  });
});

describe("resetColumn", () => {
  it("puts the column back to its default", () => {
    const widths = { name: 300, progress: 90, size: 70, status: 150, added: 120 };
    expect(resetColumn(widths, "progress")).toEqual({ ...widths, progress: DEFAULT_WIDTHS.progress });
  });

  it("lets the name column fill again", () => {
    expect(resetColumn({ ...DEFAULT_WIDTHS, name: 300 }, "name").name).toBeNull();
  });
});

describe("columnTemplate", () => {
  it("lets the name column fill until it's sized", () => {
    expect(columnTemplate(DEFAULT_WIDTHS)).toBe("minmax(120px, 1fr) 200px 120px 80px 160px 0px");
  });

  it("gives the slack to the empty column at the end once the name column is sized", () => {
    expect(columnTemplate({ ...DEFAULT_WIDTHS, name: 300 })).toBe("300px 200px 120px 80px 160px minmax(0px, 1fr)");
  });
});

describe("columnsWidth", () => {
  it("counts the filling name column at its minimum", () => {
    expect(columnsWidth(DEFAULT_WIDTHS)).toBe(120 + 120 + 80 + 200 + 160);
  });

  it("counts a sized name column at its width", () => {
    expect(columnsWidth({ ...DEFAULT_WIDTHS, name: 300 })).toBe(300 + 120 + 80 + 200 + 160);
  });
});

describe("parseColumnWidths", () => {
  it("reads back saved widths", () => {
    const widths = { name: 300, progress: 90, size: 70, status: 150, added: 120 };
    expect(parseColumnWidths(JSON.stringify(widths))).toEqual(widths);
  });

  it("uses the defaults when nothing is saved or it can't be read", () => {
    expect(parseColumnWidths(null)).toEqual(DEFAULT_WIDTHS);
    expect(parseColumnWidths("{not json")).toEqual(DEFAULT_WIDTHS);
    expect(parseColumnWidths("42")).toEqual(DEFAULT_WIDTHS);
  });

  it("drops widths that are missing, too narrow, or not numbers", () => {
    const raw = JSON.stringify({ name: null, progress: "wide", size: 2, status: 150 });
    expect(parseColumnWidths(raw)).toEqual({ ...DEFAULT_WIDTHS, status: 150 });
  });
});

describe("hidden columns", () => {
  it("shows every column but the hidden ones, and always the name", () => {
    expect(shownColumns([])).toEqual(["name", "status", "progress", "size", "added"]);
    expect(shownColumns(["status", "name"])).toEqual(["name", "progress", "size", "added"]);
  });

  it("hides a column once, shows it again, and never hides the name", () => {
    expect(withColumnShown([], "size", false)).toEqual(["size"]);
    expect(withColumnShown(["size"], "size", false)).toEqual(["size"]);
    expect(withColumnShown(["size", "status"], "size", true)).toEqual(["status"]);
    expect(withColumnShown([], "name", false)).toEqual([]);
  });

  it("lays out and measures only the shown columns, giving back hidden ones' gaps", () => {
    expect(columnTemplate(DEFAULT_WIDTHS, ["name", "size"])).toBe("minmax(120px, 1fr) 80px 0px");
    expect(columnsWidth(DEFAULT_WIDTHS, ["name", "size"])).toBe(120 + 80 - 3 * 12);
  });

  it("reads hidden columns back, leaving out unknown ones and the name", () => {
    expect(parseHiddenColumns('["size","name","nope","size"]')).toEqual(["size"]);
    expect(parseHiddenColumns(null)).toEqual([]);
    expect(parseHiddenColumns("bad")).toEqual([]);
  });
});

describe("fitColumn", () => {
  it("fits a column to its widest text, with a little room", () => {
    expect(fitColumn(DEFAULT_WIDTHS, "status", [40.2, 151.3, 90])).toEqual({ ...DEFAULT_WIDTHS, status: 156 });
  });

  it("keeps a fitted column to its minimum", () => {
    expect(fitColumn(DEFAULT_WIDTHS, "size", [10])).toEqual({ ...DEFAULT_WIDTHS, size: 56 });
  });

  it("puts a column with no text back to its default", () => {
    expect(fitColumn({ ...DEFAULT_WIDTHS, progress: 300 }, "progress", [])).toEqual(DEFAULT_WIDTHS);
  });
});
