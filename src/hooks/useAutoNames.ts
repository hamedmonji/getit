import { useEffect, useMemo, useState } from "react";
import { engine, type LinkInfo, type RenameRule } from "../lib/engine";
import { rulesKey, withAutoNames } from "../lib/queueSettings";

/**
 * `infos` with each name as the queue for `dir` would give it with its auto
 * rename `rules`, the server's kept as `original_name`. Names show as the
 * server gave them until the engine answers, and again whenever the rules change.
 */
export function useAutoNames(
  dir: string | null,
  rules: RenameRule[] | undefined,
  infos: Record<string, LinkInfo | null>,
): Record<string, LinkInfo | null> {
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const names = [...new Set(Object.values(infos).flatMap((info) => (info ? [info.file_name] : [])))];
  const namesKey = names.join("\n");
  const key = rulesKey(rules);
  const active = !!dir && !!rules?.length;
  useEffect(() => {
    if (!active || !names.length) {
      setRenamed({});
      return;
    }
    let live = true;
    engine.autoNames(dir, names).then(
      (out) => live && setRenamed(Object.fromEntries(names.map((name, i) => [name, out[i] ?? name]))),
      () => live && setRenamed({}),
    );
    return () => {
      live = false;
    };
  }, [dir, key, namesKey, active]);
  return useMemo(() => withAutoNames(infos, renamed), [infos, renamed]);
}
