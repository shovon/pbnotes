/**
 * A map that holds at most `limit` entries, and lets go of the one used
 * longest ago to make room. Knows nothing of what it holds.
 *
 * A `Map` keeps its keys in the order they were set, so a hit is moved to the
 * end by setting it again, and the first key is always the oldest.
 */
export function lru<K, V>(limit: number) {
  const entries = new Map<K, V>();
  return {
    get(key: K): V | undefined {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key: K, value: V): void {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > limit) entries.delete(entries.keys().next().value as K);
    },
    get size(): number {
      return entries.size;
    },
  };
}
