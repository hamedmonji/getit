import { beforeEach, describe, expect, it, vi } from "vitest";
import { engine } from "./engine";
import { clearProbes, knownProbe, probeLink } from "./probes";

vi.mock("./engine", () => ({
  engine: { probeLink: vi.fn() },
}));

const probe = vi.mocked(engine.probeLink);

beforeEach(() => {
  vi.clearAllMocks();
  clearProbes();
});

describe("probeLink", () => {
  it("asks the server once per link", async () => {
    probe.mockResolvedValue({ file_name: "a.zip", total_bytes: 10 });
    await probeLink("https://example.com/a.zip");
    expect(await probeLink("https://example.com/a.zip")).toEqual({ file_name: "a.zip", total_bytes: 10 });
    expect(probe).toHaveBeenCalledTimes(1);
    await probeLink("https://example.com/b.zip");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failed lookup", async () => {
    probe.mockRejectedValueOnce("HTTP 500").mockResolvedValue({ file_name: "a.zip", total_bytes: null });
    await expect(probeLink("https://example.com/a.zip")).rejects.toBe("HTTP 500");
    expect(await probeLink("https://example.com/a.zip")).toEqual({ file_name: "a.zip", total_bytes: null });
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it("fails again at once without retrying, when asked not to", async () => {
    probe.mockRejectedValueOnce("HTTP 500").mockResolvedValue({ file_name: "a.zip", total_bytes: null });
    await expect(probeLink("https://example.com/a.zip")).rejects.toBe("HTTP 500");
    await expect(probeLink("https://example.com/a.zip", false)).rejects.toBe("HTTP 500");
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("knownProbe", () => {
  it("has the answer once the server has given it, without asking again", async () => {
    probe.mockResolvedValue({ file_name: "a.zip", total_bytes: 10 });
    expect(knownProbe("https://example.com/a.zip")).toBeUndefined();
    await probeLink("https://example.com/a.zip");
    expect(knownProbe("https://example.com/a.zip")).toEqual({ file_name: "a.zip", total_bytes: 10 });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("has nothing for a failed lookup", async () => {
    probe.mockRejectedValue("HTTP 500");
    await probeLink("https://example.com/a.zip").catch(() => {});
    expect(knownProbe("https://example.com/a.zip")).toBeUndefined();
  });
});
