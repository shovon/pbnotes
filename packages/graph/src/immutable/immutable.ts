/**
 * A map from strings that is never changed (#276): `put` and `remove` hand
 * back a new map and leave the one they were given as it was, sharing all
 * but one path of it. A fold that must not change a state it handed back can
 * write one key for the cost of that path, not for a copy of every key.
 *
 * Plain data: arrays and objects, nothing else. A map survives a structured
 * clone as itself, as fold state has to (DNA.md, "A product is a fold").
 *
 * Unordered. Two maps holding the same keys and values are the same data
 * however they came to hold them, so `deepStrictEqual` compares them as maps.
 * Iterating goes in the order of each key's hash, the same on every machine.
 *
 * Knows nothing about what it holds.
 */

/** One key and its value. */
type Leaf<V> = { readonly k: string; readonly v: V };

/** Keys whose hashes are the same all the way down, in key order. */
type Clash<V> = { readonly clash: readonly Leaf<V>[] };

/** 32 slots, each one empty, a key, a clash, or a trie for the next 5 bits. */
type Trie<V> = readonly Slot<V>[];
type Slot<V> = Leaf<V> | Clash<V> | Trie<V> | undefined;

export type ImmutableMap<V> = {
  readonly size: number;
  readonly root: Trie<V>;
};

const BITS = 5;
const WIDTH = 1 << BITS;
const MASK = WIDTH - 1;

const EMPTY_TRIE: Trie<never> = Object.freeze(new Array<undefined>(WIDTH).fill(undefined));
const EMPTY: ImmutableMap<never> = Object.freeze({ size: 0, root: EMPTY_TRIE });

/** FNV-1a over UTF-16 code units: the same on every machine. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const slotAt = (h: number, shift: number) => (h >>> shift) & MASK;
const isTrie = <V>(slot: Slot<V>): slot is Trie<V> => Array.isArray(slot);
const isClash = <V>(slot: Slot<V>): slot is Clash<V> =>
  slot !== undefined && !Array.isArray(slot) && "clash" in slot;

function leafOf<V>(trie: Trie<V>, h: number, key: string): Leaf<V> | undefined {
  for (let shift = 0; ; shift += BITS) {
    const slot = trie[slotAt(h, shift)];
    if (slot === undefined) return undefined;
    if (isTrie(slot)) {
      trie = slot;
      continue;
    }
    if (isClash(slot)) return slot.clash.find((leaf) => leaf.k === key);
    return slot.k === key ? slot : undefined;
  }
}

function withSlot<V>(trie: Trie<V>, i: number, slot: Slot<V>): Trie<V> {
  const next = trie.slice();
  next[i] = slot;
  return next;
}

const byKey = <V>(a: Leaf<V>, b: Leaf<V>) => (a.k < b.k ? -1 : 1);

/** The hash every key in a leaf or a clash has. */
const hashOf = <V>(slot: Leaf<V> | Clash<V>) => hash(isClash(slot) ? slot.clash[0].k : slot.k);

/**
 * A leaf or clash that is there and a leaf with a new key, as the slot that
 * holds both from `shift` down. Keys with the same hash share a clash; any
 * others part at the first 5 bits that differ.
 */
function pair<V>(there: Leaf<V> | Clash<V>, leaf: Leaf<V>, h: number, shift: number): Slot<V> {
  const ht = hashOf(there);
  if (ht === h) {
    const clash = isClash(there) ? [...there.clash, leaf] : [there, leaf];
    return { clash: clash.sort(byKey) };
  }
  const it = slotAt(ht, shift);
  const il = slotAt(h, shift);
  if (it === il) return withSlot(EMPTY_TRIE as Trie<V>, it, pair(there, leaf, h, shift + BITS));
  return withSlot(withSlot(EMPTY_TRIE as Trie<V>, it, there), il, leaf);
}

/** `trie` with `leaf` in it from `shift` down, and whether its key is new. */
function putIn<V>(trie: Trie<V>, h: number, leaf: Leaf<V>, shift: number): [Trie<V>, boolean] {
  const i = slotAt(h, shift);
  const slot = trie[i];
  if (slot === undefined) return [withSlot(trie, i, leaf), true];
  if (isTrie(slot)) {
    const [sub, added] = putIn(slot, h, leaf, shift + BITS);
    return [withSlot(trie, i, sub), added];
  }
  if (isClash(slot) && hashOf(slot) === h) {
    const others = slot.clash.filter((it) => it.k !== leaf.k);
    return [withSlot(trie, i, { clash: [...others, leaf].sort(byKey) }), others.length === slot.clash.length];
  }
  if (!isClash(slot) && slot.k === leaf.k) return [withSlot(trie, i, leaf), false];
  return [withSlot(trie, i, pair(slot, leaf, h, shift + BITS)), true];
}

/**
 * What a slot is once a key is gone from under it: a trie left holding one
 * key and nothing deeper becomes that key, and an empty one becomes nothing,
 * so a map's shape depends only on what it holds.
 */
function collapsed<V>(trie: Trie<V>): Slot<V> {
  let only: Slot<V>;
  let count = 0;
  for (const slot of trie) {
    if (slot === undefined) continue;
    if (isTrie(slot)) return trie;
    only = slot;
    if (++count > 1) return trie;
  }
  return count === 0 ? undefined : only;
}

/** `trie` without `key` from `shift` down, or `trie` itself when it lacks it. */
function removeFrom<V>(trie: Trie<V>, h: number, key: string, shift: number): Trie<V> {
  const i = slotAt(h, shift);
  const slot = trie[i];
  if (slot === undefined) return trie;
  if (isTrie(slot)) {
    const sub = removeFrom(slot, h, key, shift + BITS);
    return sub === slot ? trie : withSlot(trie, i, collapsed(sub));
  }
  if (isClash(slot)) {
    const rest = slot.clash.filter((it) => it.k !== key);
    if (rest.length === slot.clash.length) return trie;
    return withSlot(trie, i, rest.length === 1 ? rest[0] : { clash: rest });
  }
  return slot.k === key ? withSlot(trie, i, undefined) : trie;
}

function* leaves<V>(trie: Trie<V>): Generator<Leaf<V>> {
  for (const slot of trie) {
    if (slot === undefined) continue;
    if (isTrie(slot)) yield* leaves(slot);
    else if (isClash(slot)) yield* slot.clash;
    else yield slot;
  }
}

// ── The map ─────────────────────────────────────────────────────────────────

/** The map with nothing in it. */
export function empty<V>(): ImmutableMap<V> {
  return EMPTY;
}

/** `key`'s value, or undefined when the map lacks it. */
export function get<V>(map: ImmutableMap<V>, key: string): V | undefined {
  return leafOf(map.root, hash(key), key)?.v;
}

export function has(map: ImmutableMap<unknown>, key: string): boolean {
  return leafOf(map.root, hash(key), key) !== undefined;
}

/** The map with `key` set to `value`: `map` itself when it already holds exactly that. */
export function put<V>(map: ImmutableMap<V>, key: string, value: V): ImmutableMap<V> {
  const h = hash(key);
  const was = leafOf(map.root, h, key);
  if (was && Object.is(was.v, value)) return map;
  const [root, added] = putIn(map.root, h, { k: key, v: value }, 0);
  return { size: added ? map.size + 1 : map.size, root };
}

/** The map without `key`: `map` itself when it lacks it. */
export function remove<V>(map: ImmutableMap<V>, key: string): ImmutableMap<V> {
  const h = hash(key);
  if (!leafOf(map.root, h, key)) return map;
  const root = removeFrom(map.root, h, key, 0);
  return map.size === 1 ? EMPTY : { size: map.size - 1, root };
}

/** Every key and its value. */
export function* entries<V>(map: ImmutableMap<V>): Generator<[string, V]> {
  for (const leaf of leaves(map.root)) yield [leaf.k, leaf.v];
}

export function* keys(map: ImmutableMap<unknown>): Generator<string> {
  for (const leaf of leaves(map.root)) yield leaf.k;
}

export function* values<V>(map: ImmutableMap<V>): Generator<V> {
  for (const leaf of leaves(map.root)) yield leaf.v;
}

/** A map of `pairs`; a key given twice keeps its last value. */
export function from<V>(pairs: Iterable<readonly [string, V]>): ImmutableMap<V> {
  let map = empty<V>();
  for (const [key, value] of pairs) map = put(map, key, value);
  return map;
}
