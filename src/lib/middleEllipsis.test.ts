import { describe, expect, it, vi } from "vitest";
import { middleEllipsis } from "./middleEllipsis";

const upTo = (length: number) => (candidate: string) => Array.from(candidate).length <= length;

describe("middleEllipsis", () => {
  it("leaves text that fits alone", () => {
    expect(middleEllipsis("Holiday photos", upTo(14))).toBe("Holiday photos");
  });

  it("keeps the start and end of text that doesn't fit, as much as fits", () => {
    expect(middleEllipsis("abcdefghijklmnop", upTo(7))).toBe("abc…nop");
  });

  it("gives the start any odd character", () => {
    expect(middleEllipsis("abcdefghijklmnop", upTo(8))).toBe("abcd…nop");
  });

  it("drops spaces next to the ellipsis", () => {
    expect(middleEllipsis("one two three four", upTo(10))).toBe("one t…four");
    expect(middleEllipsis("aaaa bbbb cccc dddd", upTo(8))).toBe("aaaa…ddd");
  });

  it("is only the ellipsis when nothing longer fits", () => {
    expect(middleEllipsis("abcdef", upTo(1))).toBe("…");
    expect(middleEllipsis("abcdef", () => false)).toBe("…");
  });

  it("doesn't split a character outside the basic plane", () => {
    expect(middleEllipsis("😀😀😀😀😀😀", upTo(3))).toBe("😀…😀");
  });

  it("doesn't try every length", () => {
    const fits = vi.fn(upTo(50));
    middleEllipsis("x".repeat(1000), fits);
    expect(fits.mock.calls.length).toBeLessThanOrEqual(12);
  });
});
