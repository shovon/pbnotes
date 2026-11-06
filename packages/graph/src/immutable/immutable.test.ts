/**
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { empty, entries, from, get, has, keys, put, remove, values } from "./immutable.ts";
import type { ImmutableMap } from "./immutable.ts";

/** Two keys with the same hash, found by search: they share every slot down to a clash. */
const CLASH = ["k32728", "k261234"] as const;

/** A tiny seeded generator, so a failure names the seed that made it. */
function random(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const sorted = <V>(map: ImmutableMap<V>) => [...entries(map)].sort(([a], [b]) => (a < b ? -1 : 1));

test("reads back what was put, and nothing that was removed", () => {
  let map = empty<number>();
  map = put(map, "a", 1);
  map = put(map, "b", 2);
  map = put(map, "a", 3);
  assert.equal(get(map, "a"), 3);
  assert.equal(get(map, "b"), 2);
  assert.equal(get(map, "c"), undefined);
  assert.equal(map.size, 2);
  map = remove(map, "a");
  assert.equal(has(map, "a"), false);
  assert.equal(map.size, 1);
});

test("never changes the map it was handed", () => {
  const before = from([["a", 1], ["b", 2]]);
  const copy = structuredClone(before);
  put(before, "a", 9);
  put(before, "c", 3);
  remove(before, "b");
  assert.deepEqual(before, copy);
});

test("hands back the same map for a write that changes nothing", () => {
  const map = from([["a", 1]]);
  assert.equal(put(map, "a", 1), map);
  assert.equal(remove(map, "z"), map);
  assert.equal(remove(empty(), "z").size, 0);
});

test("any key is a key, __proto__ and the empty string among them", () => {
  const map = from([["__proto__", 1], ["", 2], ["constructor", 3]]);
  assert.equal(get(map, "__proto__"), 1);
  assert.equal(get(map, ""), 2);
  assert.equal(get(map, "constructor"), 3);
  assert.equal(get(map, "toString"), undefined);
});

test("keys with the same hash are both held, and either can go", () => {
  const [a, b] = CLASH;
  let map = from([[a, 1], [b, 2]]);
  assert.equal(get(map, a), 1);
  assert.equal(get(map, b), 2);
  map = put(map, a, 3);
  assert.equal(get(map, a), 3);
  assert.equal(map.size, 2);
  map = remove(map, b);
  assert.equal(get(map, b), undefined);
  assert.equal(get(map, a), 3);
  assert.equal(map.size, 1);
});

test("the same keys and values are the same data, however the map came to hold them", () => {
  // The clashing keys with others around them, put and removed in many orders.
  const want = [...CLASH, "x", "y", "z", ...Array.from({ length: 200 }, (_, i) => `n${i}`)];
  const next = random(1);
  const once = from(want.map((k) => [k, k.length] as const));
  for (let round = 0; round < 20; round++) {
    let map = empty<number>();
    const extra = Array.from({ length: 300 }, (_, i) => `gone${round}-${i}`);
    const order = [...want, ...extra].sort(() => next() - 0.5);
    for (const k of order) map = put(map, k, k.length);
    for (const k of extra.sort(() => next() - 0.5)) map = remove(map, k);
    assert.deepEqual(map, once, `round ${round}`);
  }
});

test("agrees with a Map over many random writes", () => {
  for (const seed of [1, 2, 3]) {
    const next = random(seed);
    const pool = [...CLASH, ...Array.from({ length: 400 }, (_, i) => `key ${i}`)];
    const real = new Map<string, number>();
    let map = empty<number>();
    for (let step = 0; step < 20_000; step++) {
      const k = pool[Math.floor(next() * pool.length)];
      if (next() < 0.35) {
        real.delete(k);
        map = remove(map, k);
      } else {
        const v = Math.floor(next() * 10);
        real.set(k, v);
        map = put(map, k, v);
      }
      if (step % 997 === 0) {
        assert.equal(map.size, real.size, `seed ${seed}, step ${step}`);
        assert.deepEqual(sorted(map), [...real].sort(([a], [b]) => (a < b ? -1 : 1)));
      }
    }
    for (const k of pool) assert.equal(get(map, k), real.get(k), `seed ${seed}, ${k}`);
  }
});

test("survives a structured clone as itself", () => {
  const map = from([...CLASH.map((k) => [k, 1] as const), ["a", 2], ["b", 3]]);
  const cloned = structuredClone(map);
  assert.deepEqual(cloned, map);
  assert.equal(get(cloned, CLASH[1]), 1);
  assert.equal(get(put(cloned, "c", 4), "c"), 4);
});

test("keys, values and entries walk the same order, the same every time", () => {
  const map = from(Array.from({ length: 50 }, (_, i) => [`k${i}`, i] as const));
  const walked = [...entries(map)];
  assert.deepEqual([...keys(map)], walked.map(([k]) => k));
  assert.deepEqual([...values(map)], walked.map(([, v]) => v));
  assert.deepEqual([...entries(from([...walked].reverse()))], walked);
});
