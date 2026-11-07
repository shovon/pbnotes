/**
 * Run with: npm test
 *
 * Undo's history on its own: steps kept per graph, the way `next` decides,
 * and the cap. Graphs come from the real fold; the views are plain objects,
 * since the history only tells them apart. Each test is its own composition
 * root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batch,
  blockCreated,
  blockEdited,
  blockIndented,
  graphFold,
  tagAdded,
  blocksOn,
} from "@pbnotes/graph";
import type { Batched, Graph } from "@pbnotes/graph";
import { createHistory, LIMIT, stepOf, takenBack } from "./history.ts";
import type { Entry } from "./history.ts";

const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/** `Foo`: `a`, `b` and `c` at the top. */
const FOO = fold(
  graphFold.initial,
  blockCreated("Foo", "A", undefined, "a"),
  blockCreated("Foo", "B", "a", "b"),
  blockCreated("Foo", "C", "b", "c"),
);

/** `events` on `before`, as the history keeps them, and the graph after. */
function step(before: Graph, ...events: Batched[]): { entry: Entry; after: Graph } {
  const after = fold(before, ...events);
  const entry = stepOf(before, after, events);
  assert.ok(entry, "a step");
  return { entry, after };
}

test("a step is where it happened and what undoes it; a write that changed nothing is none", () => {
  const { entry } = step(FOO, blockEdited("b", "B!"));
  assert.deepEqual(entry.where, { page: "Foo", block: "b" });
  assert.deepEqual(entry.remembered.inverse, [blockEdited("b", "B")]);
  assert.equal(stepOf(FOO, FOO, [blockEdited("b", "B")]), undefined, "the text it had");
  assert.equal(stepOf(FOO, FOO, []), undefined);
  assert.deepEqual(step(FOO, tagAdded("foo", "Work")).entry.where, { page: "Foo" }, "a page as a whole");
});

test("next takes the latest step back, and nothing once there is none", () => {
  const history = createHistory<object>();
  const view = {};
  assert.deepEqual(history.next(view, "undo", FOO), { kind: "nothing" });
  const { entry, after } = step(FOO, blockEdited("b", "B!"));
  history.record(view, entry);
  const next = history.next(view, "undo", after);
  assert.equal(next.kind, "take");
  assert.deepEqual(next.kind === "take" && next.inverse, [blockEdited("b", "B")]);
  assert.deepEqual(history.next(view, "redo", after), { kind: "nothing" });
});

test("a step someone else changed stops undo there, and stays until the change goes away", () => {
  const history = createHistory<object>();
  const view = {};
  const first = step(FOO, blockEdited("a", "A!"));
  const second = step(first.after, blockEdited("b", "B!"));
  history.record(view, first.entry);
  history.record(view, second.entry);
  const theirs = fold(second.after, blockEdited("b", "theirs"));
  const stopped = { kind: "stopped", why: "changed", where: { page: "Foo", block: "b" } };
  assert.deepEqual(history.next(view, "undo", theirs), stopped);
  assert.deepEqual(history.next(view, "undo", theirs), stopped, "still, and never the step before");
  const back = fold(theirs, blockEdited("b", "B!"));
  assert.equal(history.next(view, "undo", back).kind, "take", "their change went away");
});

test("a step that cannot be undone stops undo there, and a step after it still undoes", () => {
  const history = createHistory<object>();
  const view = {};
  // No event is impossible to undo since #252, so the step is made one by
  // hand, as an event whose module says `undo: "cannot"` would make it.
  const moved = step(FOO, blockIndented({ id: "c", parent: "b" }));
  const stuck = { ...moved, entry: { ...moved.entry, remembered: { ...moved.entry.remembered, inverse: undefined as Batched[] | undefined } } };
  history.record(view, stuck.entry);
  const later = step(stuck.after, blockEdited("b", "B!"));
  history.record(view, later.entry);
  const next = history.next(view, "undo", later.after);
  assert.equal(next.kind, "take");
  if (next.kind !== "take") return;
  const undone = fold(later.after, ...next.inverse);
  const done = takenBack(next.entry, later.after, batch(next.inverse));
  history.taken(view, "undo", next.entry, done);
  const cannot = { kind: "stopped", why: "cannot", where: { page: "Foo", block: "c" } };
  assert.deepEqual(history.next(view, "undo", undone), cannot);
  assert.deepEqual(history.next(view, "undo", undone), cannot, "still");
});

test("a step with nothing left to undo is passed over, and the one before it taken", () => {
  const history = createHistory<object>();
  const view = {};
  const first = step(FOO, blockEdited("a", "A!"));
  history.record(view, first.entry);
  history.record(view, { events: [], remembered: { inverse: [], expected: [] }, where: { page: "Foo" } });
  const next = history.next(view, "undo", first.after);
  assert.equal(next.kind === "take" && next.entry, first.entry);
});

test("taking a step back keeps the other way what it wrote, to write again", () => {
  const { entry, after } = step(FOO, blockEdited("b", "B!"));
  const written = batch([blockEdited("b", "B")]);
  const back = takenBack(entry, after, written);
  assert.deepEqual(back.events, [written]);
  assert.deepEqual(back.remembered.inverse, entry.events, "redo writes the step again");
  assert.deepEqual(back.where, entry.where);
});

test("taken moves a step to the other way, and a new step clears redo", () => {
  const history = createHistory<object>();
  const view = {};
  const { entry, after } = step(FOO, blockEdited("b", "B!"));
  history.record(view, entry);
  const next = history.next(view, "undo", after);
  assert.ok(next.kind === "take");
  const undone = fold(after, ...next.inverse);
  const done = takenBack(next.entry, after, batch(next.inverse));
  history.taken(view, "undo", entry, done);
  assert.deepEqual(history.next(view, "undo", undone), { kind: "nothing" });
  const redo = history.next(view, "redo", undone);
  assert.deepEqual(redo.kind === "take" && redo.inverse, [blockEdited("b", "B!")]);
  history.record(view, step(undone, blockEdited("c", "C!")).entry);
  assert.deepEqual(history.next(view, "redo", undone), { kind: "nothing" }, "cleared");
});

test("each graph keeps its own history, and forget lets go of every one", () => {
  const history = createHistory<object>();
  const one = {};
  const two = {};
  const { entry, after } = step(FOO, blockEdited("b", "B!"));
  history.record(one, entry);
  assert.deepEqual(history.next(two, "undo", after), { kind: "nothing" });
  assert.equal(history.next(one, "undo", after).kind, "take");
  history.forget();
  assert.deepEqual(history.next(one, "undo", after), { kind: "nothing" });
});

test("past the limit the oldest step goes, and the ones kept still undo", () => {
  assert.equal(LIMIT, 1000);
  const history = createHistory<object>(3);
  const view = {};
  let graph = FOO;
  const entries: Entry[] = [];
  for (const text of ["1", "2", "3", "4"]) {
    const it = step(graph, blockEdited("a", text));
    history.record(view, it.entry);
    entries.push(it.entry);
    graph = it.after;
  }
  const taken: Entry[] = [];
  for (;;) {
    const next = history.next(view, "undo", graph);
    if (next.kind !== "take") break;
    const undone = fold(graph, ...next.inverse);
    const done = takenBack(next.entry, graph, batch(next.inverse));
    history.taken(view, "undo", next.entry, done);
    taken.push(next.entry);
    graph = undone;
  }
  assert.deepEqual(taken, entries.slice(1).reverse(), "the first of four is gone");
  assert.equal(blocksOn(graph, "foo")[0]?.text, "1");
});

/** Whether `value` holds `target` anywhere inside it, through objects, arrays and Maps. */
function reaches(value: unknown, target: object, seen = new Set<unknown>()): boolean {
  if (value === target) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  const inside = value instanceof Map ? [...value.keys(), ...value.values()] : Object.values(value);
  return inside.some((it) => reaches(it, target, seen));
}

test("a kept step holds no graph, neither the one before it nor the one after (#242)", () => {
  const { entry, after } = step(FOO, blockEdited("b", "B!"), tagAdded("Foo", "Work"));
  for (const graph of [FOO, after]) {
    for (const part of [graph, graph.forest, graph.texts, graph.titles, graph.tags]) {
      assert.equal(reaches(entry, part), false);
    }
  }
});
