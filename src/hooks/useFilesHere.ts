import { useEffect, useState } from "react";
import { engine } from "../lib/engine";

/**
 * Which of `names` are taken in `dir` by a file or a partial download, asked
 * once per name as names arrive. Empty until the answers come.
 */
export function useFilesHere(dir: string | null, names: string[]): ReadonlySet<string> {
  const [taken, setTaken] = useState<{ dir: string | null; names: Set<string>; asked: Set<string> }>(() => ({
    dir,
    names: new Set(),
    asked: new Set(),
  }));
  // A new folder starts over.
  const current = taken.dir === dir ? taken : { dir, names: new Set<string>(), asked: new Set<string>() };
  if (current !== taken) setTaken(current);

  const key = names.join("\n");
  useEffect(() => {
    if (!dir) return;
    const fresh = names.filter((n) => !current.asked.has(n));
    if (!fresh.length) return;
    fresh.forEach((n) => current.asked.add(n));
    let live = true;
    Promise.all(fresh.map((n) => engine.fileExists(dir, n).then((yes) => (yes ? [n] : []), () => [])))
      .then((found) => {
        const hits = found.flat();
        if (live && hits.length)
          setTaken((t) => (t.dir === dir ? { ...t, names: new Set([...t.names, ...hits]) } : t));
      });
    return () => {
      live = false;
      fresh.forEach((n) => current.asked.delete(n));
    };
  }, [dir, key]);

  return current.names;
}
