// Links in a pasted batch that already exist, handled in the batch itself:
// each gets a choice (skip it, keep both, or replace it), and adding carries
// the choices out.

import type { DownloadId, DownloadItem, LinkInfo } from "./engine";
import { sameUrl, withoutCopyNumber } from "./links";
import { joinPath } from "./paths";
import { displayName } from "./viewModels";

export type DupChoice = "skip" | "both" | "replace";

/** What a link in the batch clashes with. */
export type BatchDuplicate =
  /** A download of the same link, or of a file with the same name, in any folder. */
  | { kind: "download"; existing: DownloadItem }
  /** A file in the batch's folder with the name the link would get. */
  | { kind: "file"; name: string };

/** The downloads and queues the batch is checked against. */
export interface Downloads {
  downloads: Record<DownloadId, DownloadItem>;
  queues: Record<string, { id: string; dir: string }>;
}

/** Of several matching downloads, the one in `dir`'s queue, else an unfinished one, else the first. */
export function bestMatch(state: Downloads, matches: DownloadItem[], dir: string): DownloadItem | undefined {
  const here = Object.values(state.queues).find((q) => q.dir === dir)?.id;
  return matches.find((d) => d.queue_id === here) ?? matches.find((d) => d.status !== "completed") ?? matches[0];
}

/**
 * What `url` clashes with when added to `dir`: a download of the same link;
 * once its file `name` is known, a download with that name (ignoring copy
 * numbers, since signed links differ each time); else a file in `dir` among
 * `filesHere`. Null when nothing does.
 */
export function findBatchDuplicate(
  url: string,
  name: string | null,
  dir: string,
  state: Downloads,
  filesHere: ReadonlySet<string>,
): BatchDuplicate | null {
  const all = Object.values(state.downloads);
  const key = sameUrl(url);
  const base = name === null ? null : withoutCopyNumber(name);
  const existing =
    bestMatch(state, all.filter((d) => sameUrl(d.url) === key), dir) ??
    (base === null ? undefined : bestMatch(state, all.filter((d) => withoutCopyNumber(displayName(d)) === base), dir));
  if (existing) return { kind: "download", existing };
  if (name !== null && filesHere.has(name)) return { kind: "file", name };
  return null;
}

/** The batch's duplicates by link, from each link's file name as far as the server has said (`infos`). */
export function batchDuplicates(
  urls: string[],
  infos: Record<string, LinkInfo | null | undefined>,
  dir: string,
  state: Downloads,
  filesHere: ReadonlySet<string>,
): Record<string, BatchDuplicate> {
  const found: Record<string, BatchDuplicate> = {};
  for (const url of urls) {
    const info = infos[url];
    const d = findBatchDuplicate(url, info ? info.file_name : null, dir, state, filesHere);
    if (d) found[url] = d;
  }
  return found;
}

/** What can be done with a duplicate, in the order the buttons show. */
export const DUP_CHOICES: readonly DupChoice[] = ["skip", "both", "replace"];

/** A choice's button label. */
export const CHOICE_LABELS: Record<DupChoice, string> = {
  skip: "Skip",
  both: "Keep both",
  replace: "Replace",
};

/** What a choice does, for its tooltip, for a duplicate in `where` added to `here` (both as shown). */
export function choiceTitle(choice: DupChoice, d: BatchDuplicate, here: string, where: string): string {
  switch (choice) {
    case "skip":
      return "Don’t add it";
    case "both":
      return `Download it again into ${here}/`;
    case "replace":
      return d.kind === "file"
        ? "Move the file to the Trash and download it again"
        : `Remove it from ${where}/ and download it again here`;
  }
}

/** A download's state, as the line under a duplicate says it. */
export function dupStatus(item: DownloadItem): string {
  switch (item.status) {
    case "completed":
      return "downloaded";
    case "downloading":
      return item.total_bytes ? `downloading, ${Math.floor((item.downloaded / item.total_bytes) * 100)}%` : "downloading";
    default:
      return item.status;
  }
}

/** The line under a duplicate: where it is and how it's doing. */
export function dupText(d: BatchDuplicate, where: string): string {
  return d.kind === "file" ? `In ${where}/ (a file with this name)` : `In ${where}/ (${dupStatus(d.existing)})`;
}

/** The header over a batch's duplicates. */
export const dupHeading = (count: number) =>
  count === 1 ? "1 download already exists" : `${count} downloads already exist`;

/** The choice all of `urls` share, or null when they differ. */
export function sharedChoice(urls: string[], choices: Record<string, DupChoice>): DupChoice | null {
  const first = choices[urls[0]];
  return first && urls.every((u) => choices[u] === first) ? first : null;
}

/** What the user can change about the batch: which links are ticked, and each duplicate's choice. */
export interface BatchPicks {
  ticked: Set<string>;
  choices: Record<string, DupChoice>;
}

/**
 * The picks kept in step with which links are duplicates: a link newly found to
 * be one starts skipped and unticked, as nothing should be added twice unasked;
 * a link that no longer is one loses its choice.
 */
export function syncPicks(picks: BatchPicks, dupUrls: string[]): BatchPicks {
  const isDup = new Set(dupUrls);
  const fresh = dupUrls.filter((u) => !(u in picks.choices));
  const gone = Object.keys(picks.choices).filter((u) => !isDup.has(u));
  if (!fresh.length && !gone.length) return picks;
  const ticked = new Set(picks.ticked);
  const choices = { ...picks.choices };
  for (const u of gone) delete choices[u];
  for (const u of fresh) {
    choices[u] = "skip";
    ticked.delete(u);
  }
  return { ticked, choices };
}

/** Gives `urls` the choice `choice`: skipping unticks them, anything else ticks them. */
export function choose(picks: BatchPicks, urls: string[], choice: DupChoice): BatchPicks {
  const ticked = new Set(picks.ticked);
  const choices = { ...picks.choices };
  for (const u of urls) {
    choices[u] = choice;
    if (choice === "skip") ticked.delete(u);
    else ticked.add(u);
  }
  return { ticked, choices };
}

/**
 * Ticks or unticks `urls`. A duplicate follows: ticking a skipped one keeps
 * both, unticking one skips it.
 */
export function tick(picks: BatchPicks, urls: string[], on: boolean): BatchPicks {
  const ticked = new Set(picks.ticked);
  const choices = { ...picks.choices };
  for (const u of urls) {
    if (on) ticked.add(u);
    else ticked.delete(u);
    if (u in choices) choices[u] = on ? (choices[u] === "skip" ? "both" : choices[u]) : "skip";
  }
  return { ticked, choices };
}

/** The batch in the order it shows: its duplicates first, then the other links, each in their order. */
export function groupDuplicates(order: string[], dups: Record<string, BatchDuplicate>): { dups: string[]; rest: string[] } {
  return { dups: order.filter((u) => u in dups), rest: order.filter((u) => !(u in dups)) };
}

/** What adding the batch to `dir` does. */
export interface BatchPlan {
  /** New links, added (and checked) as usual, in order. */
  add: string[];
  /** Duplicates downloaded again (kept both, or replacing), in order. */
  again: string[];
  /** Existing downloads and files sent to the Trash, to be replaced. */
  trash: { ids: DownloadId[]; paths: string[] };
}

/** The plan for adding the ticked links of `order` to `dir`, by each duplicate's choice. */
export function planBatch(
  order: string[],
  picks: BatchPicks,
  dups: Record<string, BatchDuplicate>,
  dir: string,
): BatchPlan {
  const plan: BatchPlan = { add: [], again: [], trash: { ids: [], paths: [] } };
  for (const url of order) {
    if (!picks.ticked.has(url)) continue;
    const d = dups[url];
    const choice = picks.choices[url] ?? "both";
    if (!d) plan.add.push(url);
    else if (choice === "replace") {
      if (d.kind === "file") plan.trash.paths.push(joinPath(dir, d.name));
      else plan.trash.ids.push(d.existing.id);
      plan.again.push(url);
    } else if (choice !== "skip") plan.again.push(url);
  }
  return plan;
}

/** One button of a duplicate's choice control. */
export interface ChoiceOption {
  choice: DupChoice;
  label: string;
  title: string;
}

/** How a batch shows its duplicates: a header choosing for all of them, and a line under each. */
export interface DupView {
  heading: string;
  /** The choice they all share, or null when they differ. */
  choice: DupChoice | null;
  options: ChoiceOption[];
  rows: Record<string, { text: string; choice: DupChoice; options: ChoiceOption[] }>;
}

/**
 * The duplicates' part of the batch, for the links `dupUrls` in the order they
 * show; `here` is the batch's folder as shown and `whereOf` each duplicate's.
 * Null when there are none.
 */
export function duplicateView(
  dupUrls: string[],
  dups: Record<string, BatchDuplicate>,
  choices: Record<string, DupChoice>,
  here: string,
  whereOf: (d: BatchDuplicate) => string,
): DupView | null {
  if (!dupUrls.length) return null;
  const rows: DupView["rows"] = {};
  for (const url of dupUrls) {
    const d = dups[url];
    const where = whereOf(d);
    rows[url] = {
      text: dupText(d, where),
      choice: choices[url] ?? "skip",
      options: DUP_CHOICES.map((c) => ({ choice: c, label: CHOICE_LABELS[c], title: choiceTitle(c, d, here, where) })),
    };
  }
  const n = dupUrls.length;
  return {
    heading: dupHeading(n),
    choice: sharedChoice(dupUrls, choices),
    options: DUP_CHOICES.map((c) => ({
      choice: c,
      label: CHOICE_LABELS[c],
      title: n === 1 ? CHOICE_LABELS[c] : `${CHOICE_LABELS[c]} (all ${n})`,
    })),
    rows,
  };
}

/** Whether any of several pasted links is already a download, known without asking the server. */
export const anyKnownDuplicate = (urls: string[], dir: string, state: Downloads) =>
  urls.some((u) => findBatchDuplicate(u, null, dir, state, new Set()) !== null);
