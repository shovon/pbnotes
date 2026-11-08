/**
 * The emoji the picker offers, and the reads over them (#325): the groups
 * they show in, a search by name and keyword, what was used recently, and a
 * random one. Pure: the data is handed in, so a test hands in a few, and
 * the picker hands in emojibase's.
 */

/** One emoji as the data has it. emojibase's `Emoji` is one. */
export type Source = {
  readonly emoji: string;
  readonly label: string;
  readonly tags?: readonly string[];
  /** emojibase's group number. A modifier or a regional indicator has none. */
  readonly group?: number;
  readonly order?: number;
  /** The Emoji version it came in. */
  readonly version: number;
};

/** One emoji as the picker offers it. */
export type Entry = {
  readonly emoji: string;
  /** Its name, lower case as Unicode has it: "evergreen tree". */
  readonly label: string;
  readonly tags: readonly string[];
  readonly group: number;
};

/** A heading and the emoji under it. */
export type Section = { readonly label: string; readonly entries: readonly Entry[] };

/**
 * The newest Emoji version offered. Chromium draws emoji with the system's
 * font, and an emoji the font lacks shows as a box or as its parts. 15.1 is
 * in macOS 14.4 and Windows 11 alike; raise it once the oldest system the
 * app runs on draws a newer one.
 */
export const NEWEST = 15.1;

/** emojibase's groups, by number, as the picker heads them. 2 is skin tones and hair, never offered alone. */
const GROUPS: ReadonlyMap<number, string> = new Map([
  [0, 'Smileys & emotion'],
  [1, 'People & body'],
  [3, 'Animals & nature'],
  [4, 'Food & drink'],
  [5, 'Travel & places'],
  [6, 'Activities'],
  [7, 'Objects'],
  [8, 'Symbols'],
  [9, 'Flags'],
]);

/**
 * What the picker offers out of `data`: every emoji in a group it heads, up
 * to `newest`, in the data's order. Skin tones are not offered: each emoji
 * is its default (yellow) form.
 */
export function catalog(data: readonly Source[], newest = NEWEST): Entry[] {
  return data
    .filter((it) => it.group !== undefined && GROUPS.has(it.group) && it.version <= newest)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((it) => ({
      emoji: it.emoji,
      label: it.label.toLowerCase(),
      tags: (it.tags ?? []).map((tag) => tag.toLowerCase()),
      group: it.group as number,
    }));
}

/** `entries` under their group headings, in the groups' order. Empty groups are left out. */
export function sections(entries: readonly Entry[]): Section[] {
  return [...GROUPS]
    .map(([group, label]) => ({ label, entries: entries.filter((it) => it.group === group) }))
    .filter((it) => it.entries.length > 0);
}

/**
 * The entries for `recent`, in its order: what was used recently, as the
 * caller keeps it. A string the catalog doesn't offer (an icon that is not
 * an emoji, or one too new to draw) is left out, as is a repeat.
 */
export function recentOf(entries: readonly Entry[], recent: readonly string[]): Entry[] {
  const by = new Map(entries.map((it) => [it.emoji, it]));
  return [...new Set(recent)].flatMap((emoji): Entry[] => {
    const it = by.get(emoji);
    return it ? [it] : [];
  });
}

/** The words of `text`, split on anything not a letter or digit. */
const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The entries `query` finds: each word of it starts a word of the name or
 * a keyword. Ranked: the name starting with the whole query, then a word of
 * the name starting with each word, then keywords only, each in catalog
 * order. Nothing for a blank query.
 */
export function search(entries: readonly Entry[], query: string): Entry[] {
  const asked = words(query.toLowerCase());
  if (asked.length === 0) return [];
  const whole = asked.join(' ');
  const rank = (entry: Entry): number | undefined => {
    const named = words(entry.label);
    const tagged = entry.tags.flatMap(words);
    const inName = (word: string) => named.some((it) => it.startsWith(word));
    const inTags = (word: string) => tagged.some((it) => it.startsWith(word));
    if (!asked.every((word) => inName(word) || inTags(word))) return undefined;
    if (entry.label.startsWith(whole)) return 0;
    return asked.every(inName) ? 1 : 2;
  };
  return entries
    .map((entry, at) => ({ entry, at, rank: rank(entry) }))
    .filter((it): it is { entry: Entry; at: number; rank: number } => it.rank !== undefined)
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((it) => it.entry);
}

/**
 * One of `entries`, picked by `random`, a number in [0, 1) as
 * `Math.random` gives one. Undefined when there are none.
 */
export function randomOf(entries: readonly Entry[], random: () => number): Entry | undefined {
  if (entries.length === 0) return undefined;
  return entries[Math.min(entries.length - 1, Math.floor(random() * entries.length))];
}
