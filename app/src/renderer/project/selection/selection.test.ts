/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { every, extend, follow, move, pick, span, toggle } from "./selection.ts";
import type { Selection } from "./selection.ts";

const order = ["a", "b", "c", "d", "e", "f"];
const keys = (it: Selection | null) => it?.keys ?? null;
const must = (it: Selection | null): Selection => {
  assert.ok(it);
  return it;
};

test("a pick is that key alone", () => {
  assert.deepEqual(keys(pick("c")), ["c"]);
});

test("Shift+Down grows the run, and Shift+Up shrinks it back", () => {
  let it = pick("b");
  it = extend(it, order, 1);
  assert.deepEqual(keys(it), ["b", "c"]);
  it = extend(it, order, 1);
  assert.deepEqual(keys(it), ["b", "c", "d"]);
  it = extend(it, order, -1);
  assert.deepEqual(keys(it), ["b", "c"]);
});

test("the run crosses the anchor and grows the other way", () => {
  let it = pick("c");
  it = extend(it, order, 1);
  it = extend(it, order, -1);
  it = extend(it, order, -1);
  assert.deepEqual(keys(it), ["b", "c"]);
});

test("Shift+Up and Shift+Down stay put at either end", () => {
  assert.deepEqual(keys(extend(pick("a"), order, -1)), ["a"]);
  assert.deepEqual(keys(extend(pick("f"), order, 1)), ["f"]);
});

test("Up and Down replace the selection with the key beside the head", () => {
  const it = extend(pick("b"), order, 1);
  assert.deepEqual(keys(move(it, order, 1)), ["d"]);
  assert.deepEqual(keys(move(it, order, -1)), ["b"]);
  assert.deepEqual(keys(move(pick("a"), order, -1)), ["a"]);
});

test("Cmd+click adds keys with gaps between them, in the order they show", () => {
  let it = toggle(null, "e", order);
  it = toggle(it, "b", order);
  assert.deepEqual(keys(it), ["b", "e"]);
});

test("Cmd+click on a selected key takes it out, and on the last one clears", () => {
  let it = toggle(toggle(null, "b", order), "e", order);
  it = toggle(it, "b", order);
  assert.deepEqual(keys(it), ["e"]);
  assert.equal(toggle(it, "e", order), null);
});

test("Shift+Down after Cmd+click grows from the clicked key and keeps the gaps", () => {
  let it = toggle(toggle(null, "a", order), "c", order);
  it = extend(must(it), order, 1);
  assert.deepEqual(keys(it), ["a", "c", "d"]);
  it = extend(it, order, 1);
  assert.deepEqual(keys(it), ["a", "c", "d", "e"]);
});

test("a run that shrinks back past what was picked keeps what was picked", () => {
  let it = toggle(toggle(null, "a", order), "c", order);
  it = extend(must(it), order, -1);
  assert.deepEqual(keys(it), ["a", "b", "c"]);
  it = extend(it, order, 1);
  assert.deepEqual(keys(it), ["a", "c"]);
});

test("every selects the keys given, and nothing for none", () => {
  assert.deepEqual(keys(every(["b", "c"])), ["b", "c"]);
  assert.equal(every([]), null);
});

test("following a new order drops what went, and clears when the anchor went", () => {
  const it = extend(extend(pick("b"), order, 1), order, 1);
  assert.deepEqual(keys(follow(it, ["a", "b", "d", "e"])), ["b", "d"]);
  assert.equal(follow(it, ["a", "c", "d"]), null);
});

test("following keeps what is left of the run when the head went", () => {
  const it = extend(extend(pick("b"), order, 1), order, 1);
  const left = must(follow(it, ["a", "b", "c", "e"]));
  assert.deepEqual(left.keys, ["b", "c"]);
  assert.deepEqual(keys(extend(left, ["a", "b", "c", "e"], 1)), ["b", "c"]);
});

test("following keeps a Cmd+click selection whose anchor is still there", () => {
  const it = must(toggle(toggle(null, "a", order), "d", order));
  assert.deepEqual(keys(follow(it, ["a", "b", "d"])), ["a", "d"]);
  assert.equal(follow(it, ["b", "c"]), null);
});

test("the head stops only on steps, and the run still covers what is between", () => {
  const steps = ["a", "d", "e"];
  let it = extend(pick("a"), order, 1, steps);
  assert.deepEqual(keys(it), ["a", "b", "c", "d"]);
  it = extend(it, order, -1, steps);
  assert.deepEqual(keys(it), ["a"]);
});

test("a drag is the run from where it started to where it is, kept apart from what Cmd/Ctrl+drag adds to (#262)", () => {
  const order = ["a", "b", "c", "d", "e"];
  const drag = must(span([], "b", "d", order));
  assert.deepEqual(drag.keys, ["b", "c", "d"]);
  assert.deepEqual([drag.anchor, drag.head], ["b", "d"]);
  assert.deepEqual(must(span([], "d", "b", order)).keys, ["b", "c", "d"], "upward is the same run");
  assert.deepEqual(must(span(["a", "e"], "c", "d", order)).keys, ["a", "c", "d", "e"], "added to what was there");
  // Shift+Down after the drag grows it from where the drag ended.
  assert.deepEqual(extend(drag, order, 1).keys, ["b", "c", "d", "e"]);
  assert.equal(span([], "gone", "gone", order), null, "nothing that shows");
});
