/** Downloads are keyed by id, folders by their absolute path. */
export const isFolderKey = (key: string) => key.startsWith("/");
