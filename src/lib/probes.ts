// Asking the server about links before they're downloaded, once per link: the
// prompts showing them and the duplicate check when they're added share the
// answer.

import { engine, type LinkInfo } from "./engine";

const probes = new Map<string, Promise<LinkInfo>>();

/** What the server says about `url`, asked once; a failed lookup is asked again next time. */
export function probeLink(url: string): Promise<LinkInfo> {
  let probe = probes.get(url);
  if (!probe) {
    probe = engine.probeLink(url);
    probes.set(url, probe);
    probe.catch(() => probes.delete(url));
  }
  return probe;
}

/** Forgets every answer, for tests. */
export function clearProbes() {
  probes.clear();
}
