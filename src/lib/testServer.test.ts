import { describe, expect, it } from "vitest";
import { TEST_SERVER, testServerUrls } from "./testServer";

describe("testServerUrls", () => {
  const urls = testServerUrls();

  it("lists every sample and both big files", () => {
    expect(urls).toHaveLength(19);
    expect(urls.slice(-2)).toEqual([`${TEST_SERVER}/resumable.bin`, `${TEST_SERVER}/non-resumable.bin`]);
  });

  it("gives the samples as in the server's README, names escaped", () => {
    expect(urls[0]).toBe(`${TEST_SERVER}/files/report.pdf?rate=1300&delay=2`);
    expect(urls).toContain(`${TEST_SERVER}/files/README?rate=1300`);
    expect(urls).toContain(`${TEST_SERVER}/files/Big%20Buck%20Bunny.mp4?rate=1300`);
  });

  it("uses another server when given one", () => {
    expect(testServerUrls("http://localhost:9000")[0]).toMatch(/^http:\/\/localhost:9000\/files\//);
  });
});
