import { describe, expect, it } from "vitest";
import { asLink, linksIn, sameUrl, withoutCopyNumber } from "./links";

describe("asLink", () => {
  it("accepts http and https links as written", () => {
    expect(asLink("https://example.com/file.zip")).toBe("https://example.com/file.zip");
    expect(asLink("http://example.com")).toBe("http://example.com");
    expect(asLink("HTTPS://Example.com/x")).toBe("HTTPS://Example.com/x");
  });

  it("rejects other schemes", () => {
    expect(asLink("ftp://example.com/file.zip")).toBeNull();
    expect(asLink("mailto:me@example.com")).toBeNull();
    expect(asLink("file:///Users/me/file.zip")).toBeNull();
  });

  it("rejects text that isn't a URL", () => {
    expect(asLink("")).toBeNull();
    expect(asLink("example.com")).toBeNull();
    expect(asLink("https://")).toBeNull();
    expect(asLink("hello world")).toBeNull();
  });
});

describe("linksIn", () => {
  it("takes one link per line", () => {
    expect(linksIn("https://a.com/1\nhttps://b.com/2\r\nhttps://c.com/3")).toEqual([
      "https://a.com/1",
      "https://b.com/2",
      "https://c.com/3",
    ]);
  });

  it("takes the first link of a line with other text", () => {
    expect(linksIn("get https://a.com/1 or https://b.com/2")).toEqual(["https://a.com/1"]);
  });

  it("adds https to a lone link without a scheme", () => {
    expect(linksIn("example.com/file.zip")).toEqual(["https://example.com/file.zip"]);
    expect(linksIn("  example.com  ")).toEqual(["https://example.com"]);
  });

  it("doesn't guess a scheme when the line has other text", () => {
    expect(linksIn("see example.com/file.zip")).toEqual([]);
  });

  it("skips lines without links", () => {
    expect(linksIn("hello world\n\n/Users/me/file.zip\nftp://a.com/x")).toEqual([]);
  });

  it("keeps each link once, in first-seen order", () => {
    expect(linksIn("https://b.com\nhttps://a.com\nhttps://b.com")).toEqual(["https://b.com", "https://a.com"]);
  });
});

describe("sameUrl", () => {
  it("normalizes URLs so equal links compare equal", () => {
    expect(sameUrl("https://Example.com")).toBe("https://example.com/");
    expect(sameUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(sameUrl("HTTPS://example.com:443/x")).toBe("https://example.com/x");
  });

  it("returns text that isn't a URL unchanged", () => {
    expect(sameUrl("not a url")).toBe("not a url");
  });
});

describe("withoutCopyNumber", () => {
  it("removes the copy number before the extension", () => {
    expect(withoutCopyNumber("file (1).zip")).toBe("file.zip");
    expect(withoutCopyNumber("file (12).iso")).toBe("file.iso");
  });

  it("removes the engine's copy number, which goes before the last extension", () => {
    expect(withoutCopyNumber("file.tar (1).gz")).toBe("file.tar.gz");
  });

  it("removes a copy number before a double extension", () => {
    expect(withoutCopyNumber("file (1).tar.gz")).toBe("file.tar.gz");
  });

  it("keeps numbers too long to be copy numbers, such as years", () => {
    expect(withoutCopyNumber("Report (2023).pdf")).toBe("Report (2023).pdf");
    expect(withoutCopyNumber("Report (999).pdf")).toBe("Report.pdf");
  });

  it("removes the copy number from names without an extension", () => {
    expect(withoutCopyNumber("file (3)")).toBe("file");
  });

  it("leaves names without a copy number alone", () => {
    expect(withoutCopyNumber("file.zip")).toBe("file.zip");
    expect(withoutCopyNumber("file(1).zip")).toBe("file(1).zip");
    expect(withoutCopyNumber("file (1) final.zip")).toBe("file (1) final.zip");
    expect(withoutCopyNumber("file (a).zip")).toBe("file (a).zip");
  });
});
