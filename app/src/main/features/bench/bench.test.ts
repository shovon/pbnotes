/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBench } from "./bench.ts";
import type { Slot, SlotStore } from "./bench.ts";

// Composition root for these tests: slot values kept in a Map, and one slot
// that holds a list of strings, which is all a test needs of what a slot is.

function memoryStore(): SlotStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const key = (projectId: string, slot: string) => `${projectId}\u0000${slot}`;
  return {
    rows,
    read: (projectId, slot) => rows.get(key(projectId, slot)),
    write: (projectId, slot, json) => {
      rows.set(key(projectId, slot), json);
    },
  };
}

const words: Slot<string[]> = {
  decode: (raw) =>
    Array.isArray(raw) && raw.every((item) => typeof item === "string")
      ? raw
      : undefined,
};

/** Keeps `name` and drops every other field. */
const named: Slot<{ name: string }> = {
  decode: (raw) => {
    const name = (raw as { name?: unknown } | null)?.name;
    return typeof name === "string" ? { name } : undefined;
  },
};

const setup = () => {
  const store = memoryStore();
  const bench = createBench(
    store,
    new Map<string, Slot<unknown>>([
      ["words", words],
      ["named", named],
    ]),
  );
  return { store, bench };
};

test("a value set is the value got", () => {
  const { bench } = setup();
  bench.set("p1", "words", ["a", "b"]);
  assert.deepEqual(bench.get("p1", "words"), ["a", "b"]);
});

test("a slot never set is empty", () => {
  const { bench } = setup();
  assert.equal(bench.get("p1", "words"), undefined);
});

test("each project has its own value", () => {
  const { bench } = setup();
  bench.set("p1", "words", ["one"]);
  bench.set("p2", "words", ["two"]);
  assert.deepEqual(bench.get("p1", "words"), ["one"]);
  assert.deepEqual(bench.get("p2", "words"), ["two"]);
});

test("a set replaces the value before it", () => {
  const { bench } = setup();
  bench.set("p1", "words", ["old"]);
  bench.set("p1", "words", ["new"]);
  assert.deepEqual(bench.get("p1", "words"), ["new"]);
});

test("a value the slot does not accept is refused and nothing is kept", () => {
  const { store, bench } = setup();
  assert.throws(() => bench.set("p1", "words", "not a list"), TypeError);
  assert.equal(store.rows.size, 0);
});

test("what is kept is what the slot decoded, not what arrived", () => {
  const { bench } = setup();
  bench.set("p1", "named", { name: "Mira", extra: true });
  assert.deepEqual(bench.get("p1", "named"), { name: "Mira" });
});

test("a stored value that no longer decodes reads as empty", () => {
  const { store, bench } = setup();
  store.write("p1", "words", JSON.stringify({ shape: "from an older build" }));
  assert.equal(bench.get("p1", "words"), undefined);
});

test("a stored value that is not JSON reads as empty", () => {
  const { store, bench } = setup();
  store.write("p1", "words", "{damaged");
  assert.equal(bench.get("p1", "words"), undefined);
});

test("a slot that is not declared is refused both ways", () => {
  const { bench } = setup();
  assert.throws(() => bench.get("p1", "nope"), /no slot named "nope"/);
  assert.throws(() => bench.set("p1", "nope", []), /no slot named "nope"/);
  assert.throws(() => bench.get("p1", "__proto__"), /no slot named/);
});
