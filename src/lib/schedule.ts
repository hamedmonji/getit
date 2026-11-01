// A queue's schedule: any time, or only inside daily time windows. The engine
// holds the queue outside them; these show and edit the schedule.

import type { QueueSettings, Schedule, ScheduleMode, TimeWindow } from "./engine";

/** Minutes in a day. */
export const DAY = 24 * 60;
/** What the timeline's hover snaps to, in minutes. */
export const HOVER_STEP = 5;
/** The window added to a schedule that has none: 22:00–23:30. */
export const FIRST_WINDOW: TimeWindow = { start: 22 * 60, end: 23 * 60 + 30 };
/** How long after the last window a new one starts, and how long it lasts. */
export const ADDED_GAP = 60;
export const ADDED_LENGTH = 90;
/** The timeline's axis labels. */
export const AXIS_LABELS = ["00", "06", "12", "18", "24"];

/** Minutes since midnight of an `HH:MM` time, or null if it isn't one. */
export function toMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** `minute` (since midnight, wrapping past a day) as `HH:MM`. */
export function formatMinute(minute: number): string {
  const m = ((minute % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes since local midnight of `date`. */
export function minuteOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Whether `window` covers no time at all; it's ignored. */
export function isEmpty(window: TimeWindow): boolean {
  return window.start === window.end;
}

/** Whether `minute` falls inside `window`. One that ends before it starts runs past midnight. */
export function windowContains(window: TimeWindow, minute: number): boolean {
  const { start, end } = window;
  if (start < end) return start <= minute && minute < end;
  if (end < start) return minute >= start || minute < end;
  return false;
}

/** Whether a queue with `schedule` may run at `minute`. */
export function scheduleAllows(schedule: Schedule, minute: number): boolean {
  return schedule.mode === "any" || schedule.windows.some((w) => windowContains(w, minute));
}

export interface Segment {
  /** Where it starts and how wide it is, as fractions of the day. */
  left: number;
  width: number;
}

/** What the timeline draws for `windows`: one segment each, two for one past midnight. */
export function segments(windows: TimeWindow[]): Segment[] {
  const span = (from: number, to: number) => ({ left: from / DAY, width: (to - from) / DAY });
  return windows.flatMap((w) => {
    if (isEmpty(w)) return [];
    return w.start < w.end ? [span(w.start, w.end)] : [span(w.start, DAY), span(0, w.end)];
  });
}

/** The minute at `fraction` of the way across the timeline, snapped to `HOVER_STEP`. */
export function minuteAt(fraction: number): number {
  const minute = Math.round((Math.min(1, Math.max(0, fraction)) * DAY) / HOVER_STEP) * HOVER_STEP;
  return Math.min(minute, DAY - HOVER_STEP);
}

/** The timeline's tooltip at `minute`: the time, and whether the queue runs then. */
export function hoverLabel(windows: TimeWindow[], minute: number): string {
  return `${formatMinute(minute)} · ${windows.some((w) => windowContains(w, minute)) ? "on" : "off"}`;
}

/** How long `window` lasts, as `5h 45m`, `1h` or `30m`. */
export function durationLabel(window: TimeWindow): string {
  const length = (window.end - window.start + DAY) % DAY;
  const [h, m] = [Math.floor(length / 60), length % 60];
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

/** `windows` with one more: starting an hour after the last one ends, or `FIRST_WINDOW`. */
export function addWindow(windows: TimeWindow[]): TimeWindow[] {
  const last = windows[windows.length - 1];
  if (!last) return [FIRST_WINDOW];
  const start = (last.end + ADDED_GAP) % DAY;
  return [...windows, { start, end: (start + ADDED_LENGTH) % DAY }];
}

/** `window` with its start or end set to the `HH:MM` time typed; unchanged if it isn't one. */
export function setWindowTime(window: TimeWindow, edge: "start" | "end", text: string): TimeWindow {
  const minute = toMinute(text);
  return minute === null || minute === window[edge] ? window : { ...window, [edge]: minute };
}

/** `windows` with the one at `index` replaced by `window`. */
export function replaceWindow(windows: TimeWindow[], index: number, window: TimeWindow): TimeWindow[] {
  return windows.map((w, i) => (i === index ? window : w));
}

/** `windows` without the one at `index`. */
export function removeWindow(windows: TimeWindow[], index: number): TimeWindow[] {
  return windows.filter((_, i) => i !== index);
}

/** `settings` with the schedule's mode set; windows are kept for going back to hours. */
export function withScheduleMode(settings: QueueSettings, mode: ScheduleMode): QueueSettings {
  return settings.schedule.mode === mode ? settings : { ...settings, schedule: { ...settings.schedule, mode } };
}

/** `settings` with the schedule's windows replaced. */
export function withWindows(settings: QueueSettings, windows: TimeWindow[]): QueueSettings {
  return { ...settings, schedule: { ...settings.schedule, windows } };
}
