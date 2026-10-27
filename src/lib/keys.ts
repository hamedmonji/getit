/** Downloads are keyed by id, folders by their absolute path. */
export const isFolderKey = (key: string) => key.startsWith("/");

/** Splits item keys into download ids and folder paths. */
export function splitKeys(keys: string[]): { ids: string[]; paths: string[] } {
  return { ids: keys.filter((key) => !isFolderKey(key)), paths: keys.filter(isFolderKey) };
}
