/**
 * What a text renders to, kept by the text, so drawing the same text again
 * is free (#338's follow-up). A block parses its Markdown in render, and a
 * tab shown again mounts every block anew: without this, showing a long
 * journal parses each of its blocks again, every time.
 *
 * Generic: it knows nothing of Markdown or React, only that `render` gives
 * the same answer for the same text. The newest `limit` texts are kept, the
 * one used longest ago going first, so it stays bounded however much is
 * written; a text written since is new, and is rendered once.
 */
export type Parsed<T> = (text: string) => T;

export function createParsed<T>(render: (text: string) => T, limit: number): Parsed<T> {
  const kept = new Map<string, T>();
  return (text) => {
    const hit = kept.get(text);
    if (hit !== undefined || kept.has(text)) {
      // Used again: the newest now, so it is the last to go.
      kept.delete(text);
      kept.set(text, hit as T);
      return hit as T;
    }
    const made = render(text);
    kept.set(text, made);
    if (kept.size > limit) kept.delete(kept.keys().next().value as string);
    return made;
  };
}
