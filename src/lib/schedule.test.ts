import { describe, expect, it } from "vitest";
import type { QueueSettings, TimeWindow } from "./engine";
import {
  DAY,
  FIRST_WINDOW,
  addWindow,
  durationLabel,
  formatMinute,
  hoverLabel,
  minuteAt,
  removeWindow,
  replaceWindow,
  scheduleAllows,
  segments,
  setWindowTime,
  toMinute,
  windowContains,
  withScheduleMode,
  withWindows,
} from "./schedule";

const w = (start: string, end: string): TimeWindow => ({ start: toMinute(start)!, end: toMinute(end)! });

const settings = (mode: "any" | "hours", windows: TimeWindow[]): QueueSettings => ({
  max_concurrent: 2,
  paused: false,
  retries: 3,
  rename: [],
  schedule: { mode, windows },
});

const at = (time: string) => toMinute(time)!;

describe("toMinute and formatMinute", () => {
  it("read and write HH:MM", () => {
    expect(toMinute("01:00")).toBe(60);
    expect(toMinute("23:59")).toBe(1439);
    expect(toMinute("6:45")).toBe(405);
    expect(formatMinute(405)).toBe("06:45");
    expect(formatMinute(0)).toBe("00:00");
  });

  it("refuse anything else", () => {
    expect(toMinute("")).toBeNull();
    expect(toMinute("24:00")).toBeNull();
    expect(toMinute("12:60")).toBeNull();
    expect(toMinute("noon")).toBeNull();
  });

  it("wraps past a day", () => {
    expect(formatMinute(DAY + 30)).toBe("00:30");
    expect(formatMinute(-30)).toBe("23:30");
  });
});

describe("windowContains", () => {
  it("includes the start and not the end", () => {
    const win = w("01:00", "06:45");
    expect(windowContains(win, at("00:59"))).toBe(false);
    expect(windowContains(win, at("01:00"))).toBe(true);
    expect(windowContains(win, at("06:44"))).toBe(true);
    expect(windowContains(win, at("06:45"))).toBe(false);
  });

  it("runs past midnight when it ends before it starts", () => {
    const win = w("22:00", "01:30");
    expect(windowContains(win, at("23:00"))).toBe(true);
    expect(windowContains(win, at("00:10"))).toBe(true);
    expect(windowContains(win, at("01:30"))).toBe(false);
    expect(windowContains(win, at("12:00"))).toBe(false);
  });

  it("never holds an empty window", () => {
    expect(windowContains(w("03:00", "03:00"), at("03:00"))).toBe(false);
  });
});

describe("scheduleAllows", () => {
  it("runs any time without hours", () => {
    expect(scheduleAllows(settings("any", []).schedule, 0)).toBe(true);
  });

  it("runs inside any of its windows, overlapping or not", () => {
    const s = settings("hours", [w("01:00", "03:00"), w("02:00", "04:00")]).schedule;
    expect(scheduleAllows(s, at("03:30"))).toBe(true);
    expect(scheduleAllows(s, at("04:00"))).toBe(false);
    expect(scheduleAllows(settings("hours", []).schedule, at("04:00"))).toBe(false);
  });
});

describe("segments", () => {
  it("draws a window as a fraction of the day", () => {
    expect(segments([w("06:00", "12:00")])).toEqual([{ left: 0.25, width: 0.25 }]);
  });

  it("splits a window past midnight in two and skips empty ones", () => {
    expect(segments([w("18:00", "06:00"), w("03:00", "03:00")])).toEqual([
      { left: 0.75, width: 0.25 },
      { left: 0, width: 0.25 },
    ]);
  });
});

describe("hover", () => {
  it("snaps to five minutes within the day", () => {
    expect(minuteAt(0.5)).toBe(720);
    expect(minuteAt(61 / DAY)).toBe(60);
    expect(minuteAt(1)).toBe(DAY - 5);
    expect(minuteAt(-1)).toBe(0);
  });

  it("says whether the queue runs then", () => {
    expect(hoverLabel([w("01:00", "06:45")], at("02:00"))).toBe("02:00 · on");
    expect(hoverLabel([w("01:00", "06:45")], at("07:00"))).toBe("07:00 · off");
  });
});

describe("durationLabel", () => {
  it("shows hours and minutes", () => {
    expect(durationLabel(w("01:00", "06:45"))).toBe("5h 45m");
    expect(durationLabel(w("01:00", "02:00"))).toBe("1h");
    expect(durationLabel(w("01:00", "01:30"))).toBe("30m");
    expect(durationLabel(w("23:00", "01:00"))).toBe("2h");
    expect(durationLabel(w("01:00", "01:00"))).toBe("0m");
  });
});

describe("editing windows", () => {
  it("adds 22:00–23:30 first, then 90 minutes an hour after the last", () => {
    expect(addWindow([])).toEqual([FIRST_WINDOW]);
    expect(addWindow([w("01:00", "06:45")])).toEqual([w("01:00", "06:45"), w("07:45", "09:15")]);
    expect(addWindow([w("20:00", "23:30")])[1]).toEqual(w("00:30", "02:00"));
  });

  it("sets a time typed, ignoring one half typed", () => {
    const win = w("01:00", "06:45");
    expect(setWindowTime(win, "end", "07:00")).toEqual(w("01:00", "07:00"));
    expect(setWindowTime(win, "start", "")).toBe(win);
  });

  it("replaces and removes by index", () => {
    const windows = [w("01:00", "02:00"), w("03:00", "04:00")];
    expect(replaceWindow(windows, 1, w("05:00", "06:00"))).toEqual([w("01:00", "02:00"), w("05:00", "06:00")]);
    expect(removeWindow(windows, 0)).toEqual([w("03:00", "04:00")]);
  });

  it("keeps the windows when switching to any time", () => {
    const s = settings("hours", [w("01:00", "02:00")]);
    expect(withScheduleMode(s, "any").schedule).toEqual({ mode: "any", windows: [w("01:00", "02:00")] });
    expect(withScheduleMode(s, "hours")).toBe(s);
    expect(withWindows(s, []).schedule.windows).toEqual([]);
  });
});

