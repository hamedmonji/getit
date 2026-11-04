import { describe, expect, it } from "vitest";
import {
  clampConnections,
  DEFAULT_DOWNLOAD_PREFS,
  MAX_CONNECTIONS,
  MIN_CONNECTIONS,
  stepConnections,
  typedConnections,
} from "./downloadPrefs";

describe("download prefs", () => {
  it("start with sixteen connections and keeping the Mac awake", () => {
    expect(DEFAULT_DOWNLOAD_PREFS).toEqual({ connections: 16, keep_awake: true });
  });

  it("allow from 1 to 32 connections", () => {
    expect([MIN_CONNECTIONS, MAX_CONNECTIONS]).toEqual([1, 32]);
  });
});

describe("clampConnections", () => {
  it("keeps a count within those allowed", () => {
    expect(clampConnections(6)).toBe(6);
    expect(clampConnections(0)).toBe(1);
    expect(clampConnections(100)).toBe(32);
  });
});

describe("stepConnections", () => {
  it("steps up and down, but not past the ends", () => {
    expect(stepConnections(4, 1)).toBe(5);
    expect(stepConnections(4, -1)).toBe(3);
    expect(stepConnections(1, -1)).toBe(1);
    expect(stepConnections(32, 1)).toBe(32);
  });
});

describe("typedConnections", () => {
  it("reads a whole number", () => {
    expect(typedConnections(" 12 ")).toBe(12);
  });

  it("brings a number outside the range to its nearest end", () => {
    expect(typedConnections("0")).toBe(1);
    expect(typedConnections("64")).toBe(32);
  });

  it("is null for anything that isn't a whole number", () => {
    expect(typedConnections("")).toBeNull();
    expect(typedConnections("4.5")).toBeNull();
    expect(typedConnections("-2")).toBeNull();
    expect(typedConnections("many")).toBeNull();
  });
});
