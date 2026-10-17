import { describe, expect, it } from "vitest";
import { formatEta, formatSize, formatSpeed, plural } from "./format";

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

describe("formatSize", () => {
  it("shows gigabytes with one decimal", () => {
    expect(formatSize(GB)).toBe("1.0 GB");
    expect(formatSize(2.25 * GB)).toBe("2.3 GB");
  });

  it("rounds sizes of 10 MB and more to whole megabytes", () => {
    expect(formatSize(10 * MB)).toBe("10 MB");
    expect(formatSize(512.6 * MB)).toBe("513 MB");
  });

  it("shows smaller megabyte sizes with one decimal", () => {
    expect(formatSize(1.5 * MB)).toBe("1.5 MB");
    expect(formatSize(0.1 * MB)).toBe("0.1 MB");
    expect(formatSize(0)).toBe("0.0 MB");
  });

  it("shows tiny sizes in kilobytes, at least 1", () => {
    expect(formatSize(50 * KB)).toBe("50 KB");
    expect(formatSize(1)).toBe("1 KB");
  });
});

describe("formatSpeed", () => {
  it("shows megabytes per second with one decimal", () => {
    expect(formatSpeed(MB)).toBe("1.0 MB/s");
    expect(formatSpeed(12.34 * MB)).toBe("12.3 MB/s");
  });

  it("shows slower speeds in whole kilobytes per second", () => {
    expect(formatSpeed(300 * KB)).toBe("300 KB/s");
    expect(formatSpeed(0)).toBe("0 KB/s");
  });
});

describe("formatEta", () => {
  it("shows hours and minutes", () => {
    expect(formatEta(3600)).toBe("1h 0m");
    expect(formatEta(2 * 3600 + 5 * 60 + 30)).toBe("2h 5m");
  });

  it("shows minutes and seconds", () => {
    expect(formatEta(90)).toBe("1m 30s");
  });

  it("shows seconds, at least 1", () => {
    expect(formatEta(42.9)).toBe("42s");
    expect(formatEta(0)).toBe("1s");
  });

  it("shows a dash when unknown", () => {
    expect(formatEta(Infinity)).toBe("—");
    expect(formatEta(NaN)).toBe("—");
  });
});

describe("plural", () => {
  it("adds an s except for one", () => {
    expect(plural(0, "item")).toBe("0 items");
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(2, "item")).toBe("2 items");
  });
});
