import { describe, expect, it } from "vitest";
import { queue } from "../test/fixtures";
import { bestQueueFor, wordsIn } from "./match";

describe("wordsIn", () => {
  it("gives lowercase words of three letters or more", () => {
    expect(wordsIn("Ubuntu-24.04 Desktop_AMD64.iso")).toEqual(["ubuntu", "desktop", "amd64", "iso"]);
  });

  it("drops numbers, short words and noise", () => {
    expect(wordsIn("Download the latest release 2024 of my app")).toEqual(["app"]);
  });

  it("keeps letters outside ASCII", () => {
    expect(wordsIn("Café Müller")).toEqual(["café", "müller"]);
  });
});

describe("bestQueueFor", () => {
  const linux = queue({ id: "linux", dir: "/home/Linux Iso" });
  const ubuntu = queue({ id: "ubuntu", dir: "/home/Ubuntu Releases" });
  const music = queue({ id: "music", dir: "/home/Music" });

  it("picks the queue sharing the most words with the text", () => {
    expect(bestQueueFor("ubuntu linux iso", [music, ubuntu, linux])).toBe(linux);
  });

  it("matches words that start one another", () => {
    expect(bestQueueFor("ubuntu2404 desktop", [music, ubuntu])).toBe(ubuntu);
  });

  it("only matches prefixes of four letters or more", () => {
    const iso = queue({ id: "iso", dir: "/home/iso" });
    expect(bestQueueFor("isolinux", [iso])).toBeNull();
  });

  it("picks the first queue on a tie", () => {
    const a = queue({ id: "a", dir: "/x/Ubuntu" });
    const b = queue({ id: "b", dir: "/y/Ubuntu" });
    expect(bestQueueFor("ubuntu", [a, b])).toBe(a);
  });

  it("is null when no queue shares a word, or the text has none", () => {
    expect(bestQueueFor("photos", [linux, music])).toBeNull();
    expect(bestQueueFor("the 2024 download", [linux])).toBeNull();
  });
});
