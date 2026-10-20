// Asking the server about links before they're downloaded, once per link: the
// prompts showing them and the duplicate check when they're added share the
// answer.

import { engine, type LinkInfo } from "./engine";

const probes = new Map<string, Promise<LinkInfo>>();
const answers = new Map<string, LinkInfo>();
const failures = new Map<string, unknown>();

/**
 * What the server says about `url`, asked once. A failed lookup is asked
 * again next time, unless `retry` is false: then it fails again at once.
 */
export function probeLink(url: string, retry = true): Promise<LinkInfo> {
  if (!retry && failures.has(url)) return Promise.reject(failures.get(url));
  let probe = probes.get(url);
  if (!probe) {
    probe = engine.probeLink(url);
    probes.set(url, probe);
    probe.then(
      (info) => {
        answers.set(url, info);
        failures.delete(url);
      },
      (e) => {
        probes.delete(url);
        failures.set(url, e);
      },
    );
  }
  return probe;
}

/** What the server already said about `url`, without asking; undefined if it hasn't yet. */
export function knownProbe(url: string): LinkInfo | undefined {
  return answers.get(url);
}

/** Forgets every answer, for tests. */
export function clearProbes() {
  probes.clear();
  answers.clear();
  failures.clear();
}
