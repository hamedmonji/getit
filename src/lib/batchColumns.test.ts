import { describe, expect, it } from "vitest";
import {
  batchTableWidth,
  batchTemplate,
  DEFAULT_BATCH_WIDTHS,
  fitBatchColumn,
  parseBatchWidths,
  pinBatchColumns,
  resizeBatchColumn,
} from "./batchColumns";

describe("batchTemplate", () => {
  it("shares the room between name and link until they have widths", () => {
    expect(batchTemplate(DEFAULT_BATCH_WIDTHS)).toBe("14px 16px minmax(120px, 1fr) 72px minmax(120px, 1.3fr) 0px");
  });

  it("gives the slack to an empty column at the end once every column has a width", () => {
    expect(batchTemplate({ name: 200, size: 80, link: 300 })).toBe("14px 16px 200px 80px 300px minmax(0px, 1fr)");
  });
});

describe("resizing", () => {
  it("keeps columns to their minimums, in whole pixels", () => {
    expect(resizeBatchColumn(DEFAULT_BATCH_WIDTHS, "size", 90.6).size).toBe(91);
    expect(resizeBatchColumn(DEFAULT_BATCH_WIDTHS, "size", 10).size).toBe(48);
    expect(resizeBatchColumn(DEFAULT_BATCH_WIDTHS, "name", 50).name).toBe(120);
  });

  it("fixes the sharing columns at their widths on screen, rounded down", () => {
    expect(pinBatchColumns(DEFAULT_BATCH_WIDTHS, { name: 250.7, link: 330.2 })).toEqual({ name: 250, size: 72, link: 330 });
    expect(pinBatchColumns({ name: 180, size: 72, link: null }, { name: 250, link: 90 })).toEqual({
      name: 180,
      size: 72,
      link: 120,
    });
  });

  it("fits a column to its widest text", () => {
    expect(fitBatchColumn(DEFAULT_BATCH_WIDTHS, "size", [30, 52.2, 41]).size).toBe(57);
    expect(fitBatchColumn(DEFAULT_BATCH_WIDTHS, "size", [])).toBe(DEFAULT_BATCH_WIDTHS);
    expect(fitBatchColumn({ name: 300, size: 72, link: 300 }, "name", [60]).name).toBe(120);
  });
});

describe("parseBatchWidths", () => {
  it("reads saved widths back, falling back to the defaults for anything wrong", () => {
    expect(parseBatchWidths('{"name":210,"size":90,"link":400}')).toEqual({ name: 210, size: 90, link: 400 });
    expect(parseBatchWidths('{"name":10,"size":"wide"}')).toEqual(DEFAULT_BATCH_WIDTHS);
    expect(parseBatchWidths("not json")).toEqual(DEFAULT_BATCH_WIDTHS);
    expect(parseBatchWidths(null)).toEqual(DEFAULT_BATCH_WIDTHS);
  });
});

describe("batchTableWidth", () => {
  it("adds the columns, gaps and padding, sharing columns at their least", () => {
    expect(batchTableWidth(DEFAULT_BATCH_WIDTHS)).toBe(14 + 16 + 120 + 72 + 120 + 50 + 40);
    expect(batchTableWidth({ name: 300, size: 80, link: 400 })).toBe(14 + 16 + 300 + 80 + 400 + 50 + 40);
  });
});
