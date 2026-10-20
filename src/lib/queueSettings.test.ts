import { describe, expect, it } from "vitest";
import { item } from "../test/fixtures";
import type { QueueSettings, RenameRule } from "./engine";
import {
  DEFAULT_LIMIT,
  MAX_RETRIES,
  applyLabel,
  limitSummary,
  limitUnit,
  previewRows,
  renameSource,
  retriesHint,
  rulePlaceholders,
  stepLimit,
  stepRetries,
  changeOp,
  isBlank,
  limitMode,
  moveRule,
  newRule,
  parseCount,
  removeRule,
  replaceRule,
  rulesKey,
  withAutoNames,
  withLimit,
} from "./queueSettings";

const settings = (max_concurrent: number | null): QueueSettings => ({
  max_concurrent,
  paused: false,
  retries: 3,
  rename: [],
});

const prefix = (text: string): RenameRule => ({ op: "prefix", text });

describe("newRule", () => {
  it("makes blank rules of each kind", () => {
    expect(newRule("prefix")).toEqual({ op: "prefix", text: "" });
    expect(newRule("suffix")).toEqual({ op: "suffix", text: "" });
    expect(newRule("remove")).toEqual({ op: "remove", pattern: { text: "", regex: false } });
    expect(newRule("replace")).toEqual({ op: "replace", pattern: { text: "", regex: false }, with: "" });
  });
});

describe("changeOp", () => {
  it("keeps the text when switching between adding and finding", () => {
    expect(changeOp(prefix("x"), "remove")).toEqual({ op: "remove", pattern: { text: "x", regex: false } });
    expect(changeOp({ op: "remove", pattern: { text: "\\d", regex: true } }, "replace")).toEqual({
      op: "replace",
      pattern: { text: "\\d", regex: true },
      with: "",
    });
    expect(changeOp({ op: "replace", pattern: { text: "a", regex: true }, with: "b" }, "suffix")).toEqual({
      op: "suffix",
      text: "a",
    });
  });

  it("makes a removing rule plain text", () => {
    expect(changeOp({ op: "replace", pattern: { text: "a+", regex: true }, with: "" }, "remove")).toEqual({
      op: "remove",
      pattern: { text: "a+", regex: false },
    });
  });

  it("returns the same rule for the same kind", () => {
    const rule = prefix("x");
    expect(changeOp(rule, "prefix")).toBe(rule);
  });
});

describe("rule lists", () => {
  const rules = [prefix("a"), prefix("b"), prefix("c")];

  it("replaces and removes by index", () => {
    expect(replaceRule(rules, 1, prefix("x"))).toEqual([prefix("a"), prefix("x"), prefix("c")]);
    expect(removeRule(rules, 0)).toEqual([prefix("b"), prefix("c")]);
  });

  it("moves a rule", () => {
    expect(moveRule(rules, 0, 2)).toEqual([prefix("b"), prefix("c"), prefix("a")]);
    expect(moveRule(rules, 2, 0)).toEqual([prefix("c"), prefix("a"), prefix("b")]);
    expect(moveRule(rules, 1, 1)).toBe(rules);
    expect(moveRule(rules, 5, 0)).toBe(rules);
  });

  it("knows a rule without text does nothing", () => {
    expect(isBlank(prefix(""))).toBe(true);
    expect(isBlank(newRule("replace"))).toBe(true);
    expect(isBlank(prefix("a"))).toBe(false);
  });
});

describe("parseCount", () => {
  it("accepts whole numbers in range", () => {
    expect(parseCount("3", 0, 20)).toBe(3);
    expect(parseCount(" 0 ", 0, 20)).toBe(0);
    expect(parseCount("20", 0, 20)).toBe(20);
  });

  it("rejects anything else", () => {
    expect(parseCount("21", 0, 20)).toBeNull();
    expect(parseCount("0", 1, 20)).toBeNull();
    expect(parseCount("2.5", 0, 20)).toBeNull();
    expect(parseCount("-1", 0, 20)).toBeNull();
    expect(parseCount("", 0, 20)).toBeNull();
    expect(parseCount("abc", 0, 20)).toBeNull();
  });
});

describe("limits", () => {
  it("tells no limit from a limit", () => {
    expect(limitMode(settings(null))).toBe("none");
    expect(limitMode(settings(3))).toBe("limit");
  });

  it("switches between no limit and a limit", () => {
    expect(withLimit(settings(3), "none").max_concurrent).toBeNull();
    expect(withLimit(settings(null), "limit").max_concurrent).toBe(DEFAULT_LIMIT);
    expect(withLimit(settings(4), "limit", 5).max_concurrent).toBe(5);
  });

  it("returns the same settings when nothing changes", () => {
    const s = settings(3);
    expect(withLimit(s, "limit")).toBe(s);
  });

  it("goes back to the limit it had before it went unlimited", () => {
    expect(withLimit(settings(null), "limit", undefined, 7).max_concurrent).toBe(7);
  });

  it("steps the limit, never below 1 and with no top", () => {
    expect(stepLimit(settings(1), -1).max_concurrent).toBe(1);
    expect(stepLimit(settings(40), 1).max_concurrent).toBe(41);
    const unlimited = settings(null);
    expect(stepLimit(unlimited, 1)).toBe(unlimited);
  });

  it("describes the limit", () => {
    expect(limitUnit(1)).toBe("download at a time");
    expect(limitUnit(3)).toBe("downloads at a time");
    expect(limitSummary(null)).toBe("Every queued item starts right away.");
    expect(limitSummary(1)).toBe("Each download finishes before the next one starts.");
    expect(limitSummary(4)).toBe("Up to 4 downloads in parallel; the rest wait in line.");
  });
});

describe("retries", () => {
  it("steps from 0 to the most", () => {
    expect({ ...settings(2), retries: 0 }).toEqual(stepRetries({ ...settings(2), retries: 0 }, -1));
    expect(stepRetries({ ...settings(2), retries: MAX_RETRIES }, 1).retries).toBe(MAX_RETRIES);
    expect(stepRetries(settings(2), 1).retries).toBe(4);
  });

  it("explains what they do", () => {
    expect(retriesHint(0)).toBe("Failed downloads stay failed");
    expect(retriesHint(3)).toBe("Waits longer between each try");
  });
});

describe("rulePlaceholders", () => {
  it("fits each kind of rule", () => {
    expect(rulePlaceholders(newRule("prefix")).text).toBe("Text to add at the start");
    expect(rulePlaceholders(newRule("suffix")).text).toBe("Text to add at the end");
    expect(rulePlaceholders(newRule("remove")).text).toBe("Text to remove");
    expect(rulePlaceholders(newRule("replace"))).toEqual({
      text: "Find exact text",
      with: "Replace with (empty removes it)",
    });
    expect(rulePlaceholders({ op: "replace", pattern: { text: "", regex: true }, with: "" }).with).toBe(
      "Replace with ($1 for groups)",
    );
  });
});

describe("rename preview", () => {
  const renamed = item({ id: "a", queue_id: "q", url: "https://e.com/a", file_name: "new a.zip", original_name: "a.zip" });
  const plain = item({ id: "b", queue_id: "q", url: "https://e.com/b.zip", file_name: "b.zip" });

  it("starts from the server's name so renames don't compound", () => {
    expect(renameSource(renamed)).toBe("a.zip");
    expect(renameSource(plain)).toBe("b.zip");
  });

  it("pairs each file's name with the one the rules give it", () => {
    expect(previewRows([renamed, plain], ["new a.zip", "new b.zip"])).toEqual([
      { id: "a", from: "new a.zip", to: "new a.zip", changed: false },
      { id: "b", from: "b.zip", to: "new b.zip", changed: true },
    ]);
  });

  it("labels the button with how many it renames", () => {
    expect(applyLabel(3)).toBe("Rename 3 already in queue");
  });
});

describe("rulesKey", () => {
  it("changes with the rules", () => {
    expect(rulesKey(undefined)).toBe(rulesKey([]));
    expect(rulesKey([prefix("a")])).not.toBe(rulesKey([prefix("b")]));
  });
});

describe("withAutoNames", () => {
  it("renames known names, keeping the server's", () => {
    const infos = {
      a: { file_name: "a.zip", total_bytes: 1 },
      b: { file_name: "b.zip", total_bytes: null },
      c: null,
    };
    expect(withAutoNames(infos, { "a.zip": "new a.zip", "b.zip": "b.zip" })).toEqual({
      a: { file_name: "new a.zip", total_bytes: 1, original_name: "a.zip" },
      b: { file_name: "b.zip", total_bytes: null },
      c: null,
    });
  });

  it("keeps names not renamed yet", () => {
    const infos = { a: { file_name: "a.zip", total_bytes: 1 } };
    expect(withAutoNames(infos, {})).toEqual(infos);
  });
});
