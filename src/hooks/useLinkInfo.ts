import { useEffect, useState } from "react";
import type { LinkInfo } from "../lib/engine";
import { probeLink } from "../lib/probes";

/**
 * What the server says about each of `urls`, filled in as the answers come:
 * null for links it couldn't say about, missing for those not answered yet.
 */
export function useLinkInfo(urls: string[]): Record<string, LinkInfo | null> {
  const [infos, setInfos] = useState<Record<string, LinkInfo | null>>({});
  const key = urls.join("\n");
  useEffect(() => {
    let live = true;
    for (const url of key.split("\n")) {
      probeLink(url).then(
        (info) => live && setInfos((prev) => ({ ...prev, [url]: info })),
        () => live && setInfos((prev) => ({ ...prev, [url]: null })),
      );
    }
    return () => {
      live = false;
    };
  }, [key]);
  return infos;
}
