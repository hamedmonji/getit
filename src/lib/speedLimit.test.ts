import { describe, expect, it } from "vitest";
import { SPEED_LIMIT_LABELS, SPEED_LIMITS, speedLimitBytes } from "./speedLimit";

describe("speedLimitBytes", () => {
  it("is null when off", () => {
    expect(speedLimitBytes("off")).toBeNull();
  });

  it("matches each label, in binary units like formatSpeed", () => {
    expect(speedLimitBytes("100k")).toBe(100 * 1024);
    expect(speedLimitBytes("1m")).toBe(1024 * 1024);
    expect(speedLimitBytes("5m")).toBe(5 * 1024 * 1024);
  });

  it("offers limits from slowest to fastest, each labelled", () => {
    const bytes = SPEED_LIMITS.slice(1).map((l) => speedLimitBytes(l)!);
    expect(bytes).toEqual([...bytes].sort((a, b) => a - b));
    for (const limit of SPEED_LIMITS) expect(SPEED_LIMIT_LABELS[limit]).toBeTruthy();
  });
});
