// Editing a queue's settings: how many downloads run at once, how often they
// retry, and the auto rename rules applied to new downloads' names.

import type { DownloadItem, LinkInfo, QueueSettings, RenameRule } from "./engine";
import { displayName } from "./viewModels";

/** Most downloads the context menu's stepper offers; the panel has no limit. */
export const MAX_CONCURRENCY = 16;
/** Most retries a queue can be set to; the engine clamps to the same. */
export const MAX_RETRIES = 10;
/** The name the rename example starts with, for the user to change. */
export const EXAMPLE_NAME = "My.Movie.2024.1080p.mkv";
/** How many of a queue's files the rename preview shows. */
export const PREVIEW_ROWS = 5;
/** The limit a queue gets when it goes from no limit to a limit. */
export const DEFAULT_LIMIT = 2;

export type RenameOp = RenameRule["op"];

export const RULE_LABELS: Record<RenameOp, string> = {
  prefix: "Add before",
  suffix: "Add after",
  remove: "Remove",
  replace: "Replace",
};

/** A blank rule of kind `op`. */
export function newRule(op: RenameOp): RenameRule {
  switch (op) {
    case "prefix":
    case "suffix":
      return { op, text: "" };
    case "remove":
      return { op, pattern: { text: "", regex: false } };
    case "replace":
      return { op, pattern: { text: "", regex: false }, with: "" };
  }
}

/**
 * `rule` changed to kind `op`, keeping the text it had: what it added becomes
 * what it finds, and back.
 */
export function changeOp(rule: RenameRule, op: RenameOp): RenameRule {
  if (rule.op === op) return rule;
  const text = "text" in rule ? rule.text : rule.pattern.text;
  const regex = "pattern" in rule ? rule.pattern.regex : false;
  switch (op) {
    case "prefix":
    case "suffix":
      return { op, text };
    case "remove":
      // Removing takes plain text only.
      return { op, pattern: { text, regex: false } };
    case "replace":
      return { op, pattern: { text, regex }, with: rule.op === "replace" ? rule.with : "" };
  }
}

/** The placeholders for a rule's fields: the text, or what to find, and what to replace it with. */
export function rulePlaceholders(rule: RenameRule): { text: string; with?: string } {
  switch (rule.op) {
    case "prefix":
      return { text: "Text to add at the start" };
    case "suffix":
      return { text: "Text to add at the end" };
    case "remove":
      return { text: "Text to remove" };
    case "replace":
      return rule.pattern.regex
        ? { text: "Pattern, e.g. \\.(1080p|720p)", with: "Replace with ($1 for groups)" }
        : { text: "Find exact text", with: "Replace with (empty removes it)" };
  }
}

/** `rules` with the one at `index` replaced by `rule`. */
export function replaceRule(rules: RenameRule[], index: number, rule: RenameRule): RenameRule[] {
  return rules.map((r, i) => (i === index ? rule : r));
}

/** `rules` without the one at `index`. */
export function removeRule(rules: RenameRule[], index: number): RenameRule[] {
  return rules.filter((_, i) => i !== index);
}

/** `rules` with the one at `from` moved to `to`. */
export function moveRule(rules: RenameRule[], from: number, to: number): RenameRule[] {
  if (from === to || from < 0 || from >= rules.length) return rules;
  const next = rules.filter((_, i) => i !== from);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, rules[from]);
  return next;
}

/** Whether `rule` does nothing yet: it has no text to add or find. */
export function isBlank(rule: RenameRule): boolean {
  return ("text" in rule ? rule.text : rule.pattern.text) === "";
}

/** A whole number typed in, within `min` and `max`; null for anything else. */
export function parseCount(text: string, min: number, max = Infinity): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export type LimitMode = "none" | "limit";

export function limitMode(settings: QueueSettings): LimitMode {
  return settings.max_concurrent === null ? "none" : "limit";
}

/**
 * `settings` with no limit, or limited to `limit` (by default the limit it
 * has, else the one it had before it went unlimited, else `DEFAULT_LIMIT`).
 */
export function withLimit(
  settings: QueueSettings,
  mode: LimitMode,
  limit?: number,
  remembered?: number,
): QueueSettings {
  const max_concurrent =
    mode === "none" ? null : Math.max(1, limit ?? settings.max_concurrent ?? remembered ?? DEFAULT_LIMIT);
  return max_concurrent === settings.max_concurrent ? settings : { ...settings, max_concurrent };
}

/** A limited queue's limit moved by `delta`, never below 1. */
export function stepLimit(settings: QueueSettings, delta: number): QueueSettings {
  return settings.max_concurrent === null ? settings : withLimit(settings, "limit", settings.max_concurrent + delta);
}

/** Retries moved by `delta`, kept from 0 to `MAX_RETRIES`. */
export function stepRetries(settings: QueueSettings, delta: number): QueueSettings {
  const retries = Math.min(MAX_RETRIES, Math.max(0, settings.retries + delta));
  return retries === settings.retries ? settings : { ...settings, retries };
}

/** The words after the limit's stepper. */
export function limitUnit(limit: number): string {
  return limit === 1 ? "download at a time" : "downloads at a time";
}

/** What the limit means, under it. */
export function limitSummary(limit: number | null): string {
  if (limit === null) return "Every queued item starts right away.";
  if (limit === 1) return "Each download finishes before the next one starts.";
  return `Up to ${limit} downloads in parallel; the rest wait in line.`;
}

/** What the retries setting means, under its label. */
export function retriesHint(retries: number): string {
  return retries === 0 ? "Failed downloads stay failed" : "Waits longer between each try";
}

/** The name auto rename starts from for a download: the server's, so renames never compound. */
export function renameSource(item: DownloadItem): string {
  return item.original_name ?? displayName(item);
}

export interface PreviewRow {
  id: string;
  /** The name it has now. */
  from: string;
  /** The name the rules give it. */
  to: string;
  changed: boolean;
}

/** Each of `items` with the name it has and the one the rules give it, from `renamed` (in the same order). */
export function previewRows(items: DownloadItem[], renamed: string[]): PreviewRow[] {
  return items.map((item, i) => {
    const from = displayName(item);
    const to = renamed[i] ?? from;
    return { id: item.id, from, to, changed: to !== from };
  });
}

/** The label of the button that renames the queue's files the rules would change. */
export function applyLabel(count: number): string {
  return `Rename ${count} already in queue`;
}

/** A key that changes whenever `rules` do, for effects that depend on them. */
export function rulesKey(rules: RenameRule[] | undefined): string {
  return JSON.stringify(rules ?? []);
}

/**
 * `infos` with each name as the queue's auto rename gives it, from `renamed`
 * (server name to new name), keeping the server's as `original_name`. Names
 * not in `renamed` yet are kept as they are.
 */
export function withAutoNames(
  infos: Record<string, LinkInfo | null>,
  renamed: Record<string, string>,
): Record<string, LinkInfo | null> {
  const out: Record<string, LinkInfo | null> = {};
  for (const [url, info] of Object.entries(infos)) {
    const name = info && renamed[info.file_name];
    out[url] = info && name && name !== info.file_name ? { ...info, file_name: name, original_name: info.file_name } : info;
  }
  return out;
}
