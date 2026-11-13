/**
 * Run with: npm test
 *
 * Undo through the graph's own fold: every kind of step done, undone and
 * redone, and whether a step still holds after other writers' changes. Each
 * test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasAdded,
  aliasRemoved,
  batch,
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockMoved,
  blockOutdented,
  each,
  getPage,
  HANDLES,
  NAMESPACE,
  UNDO,
  graphFold,
  holds,
  invert,
  pageDeleted,
  remember,
  propertyRemoved,
  propertySet,
  tagAdded,
  tagRemoved,
} from "../graph.ts";
import type { Batched, Graph } from "../graph.ts";
import { CANNOT, holds as holdsWith, invert as invertWith, remember as rememberWith, same } from "./undo.ts";
import type { Undo, UndoTable } from "./undo.ts";
import { from, get } from "../immutable/immutable.ts";

/** `invert`'s answer for a step that can be undone: never `undefined`. */
function inverseOf(before: Graph, events: Batched[]): Batched[] {
  const inverse = invert(before, events);
  assert.ok(inverse, "can be undone");
  return inverse;
}

/** `events` folded onto `state`. */
function fold(state: Graph, ...events: Batched[]): Graph {
  return events.reduce(graphFold.reduce, state);
}

/**
 * What undo puts back: what the user wrote. Not `titles`, which only ever
 * gains spellings, and not `deletions` or `edited`, which count and date.
 */
function held(graph: Graph) {
  const { forest, texts, properties, tags, aliases } = graph;
  return { forest, texts, properties, tags, aliases };
}

/**
 * `Foo`: `a` (with `a1`, `a2`), `b` (with `b1`), `c`, a property, a tag and
 * an alias. `Bar`: one block pointing at `a1` and linking `Foo`.
 */
const START = fold(
  graphFold.initial,
  blockCreated("Foo", "A", undefined, "a"),
  blockCreated("Foo", "A1", undefined, "a1", "a"),
  blockCreated("Foo", "A2", "a1", "a2", "a"),
  blockCreated("Foo", "B", "a", "b"),
  blockCreated("Foo", "B1", undefined, "b1", "b"),
  blockCreated("Foo", "C", "b", "c"),
  blockCreated("Bar", "see ((a1)) on [[Foo]]", undefined, "x"),
  propertySet("Foo", "Owner", "Mira"),
  tagAdded("Foo", "Work"),
  aliasAdded("Foo", "F"),
);

/** `Foo` as `id(children…)`, so a case reads as the outline it makes. */
function shape(graph: Graph, page = "Foo"): string {
  const walk = (blocks: { id: string; children: unknown[] }[]): string =>
    blocks
      .map((it) =>
        it.children.length ? `${it.id}(${walk(it.children as typeof blocks)})` : it.id,
      )
      .join(" ");
  return walk(getPage(graph, page).blocks);
}

/**
 * Does `events` on `start`, undoes it with one batch of `invert`'s events,
 * and redoes it with one batch of the events again, checking each lands
 * where it should. Hands back the three graphs.
 */
function roundTrip(name: string, events: Batched[], start = START) {
  const after = fold(start, ...events);
  assert.notDeepEqual(held(after), held(start), `${name}: the step changes something`);
  const inverse = inverseOf(start, events);
  assert.ok(inverse.length > 0, `${name}: has an inverse`);
  const undone = fold(after, batch(inverse));
  assert.deepEqual(held(undone), held(start), `${name}: undone`);
  const redone = fold(undone, batch([...each(events)]));
  assert.deepEqual(held(redone), held(after), `${name}: redone`);
  return { after, undone, redone };
}

test("every kind of step undoes to the graph before it, and redoes to the graph after", () => {
  const cases: [string, Batched[]][] = [
    ["create at the end", [blockCreated("Foo", "N", undefined, "n")]],
    ["create first on the page", [blockCreated("Foo", "N", undefined, "n", undefined, true)]],
    ["create a first child", [blockCreated("Foo", "N", undefined, "n", "c")]],
    ["create after a child", [blockCreated("Foo", "N", "a1", "n", "a")]],
    ["edit", [blockEdited("b", "B!")]],
    ["delete the first block, with children", [blockDeleted("a")]],
    ["delete a first child", [blockDeleted("a1")]],
    ["delete a later child", [blockDeleted("a2")]],
    ["delete a middle block, with a child", [blockDeleted("b")]],
    ["delete the last block", [blockDeleted("c")]],
    ["delete several, side by side and apart, in one batch (#258)", [batch([blockDeleted("a1"), blockDeleted("a2"), blockDeleted("c")])]],
    ["delete every top-level block, in one batch", [batch([blockDeleted("a"), blockDeleted("b"), blockDeleted("c")])]],
    ["indent a top-level block", [blockIndented({ id: "b", parent: "a" })]],
    ["indent a child", [blockIndented({ id: "a2", parent: "a1" })]],
    ["indent two siblings together, in one batch (#259)", [batch([blockIndented({ id: "b", parent: "a" }), blockIndented({ id: "c", parent: "a" })])]],
    ["outdent two siblings together, in one batch (#260)", [batch([blockOutdented({ id: "a1", after: "a" }), blockOutdented({ id: "a2", after: "a1" })])]],
    ["outdent a block with a sibling below", [blockOutdented({ id: "a1", after: "a" })]],
    ["outdent a last child", [blockOutdented({ id: "a2", after: "a" })]],
    ["move a block with children lower", [blockMoved({ id: "a", page: "Foo", after: "c" })]],
    ["move a first child under another block", [blockMoved({ id: "a1", page: "Foo", parent: "b" })]],
    ["move a block onto a new page", [blockMoved({ id: "b", page: "Bar" })]],
    ["move a page's last block away", [blockMoved({ id: "c", page: "Bar", first: true })]],
    ["set a new property", [propertySet("Foo", "Status", "done")]],
    ["change a property", [propertySet("Foo", "owner", "Sal")]],
    ["remove a property", [propertyRemoved("Foo", "Owner")]],
    ["add a tag", [tagAdded("Foo", "Home")]],
    ["remove a tag", [tagRemoved("Foo", "work")]],
    ["add an alias", [aliasAdded("Foo", "Fu")]],
    ["remove an alias", [aliasRemoved("Foo", "F")]],
    ["delete a page", [pageDeleted("Foo")]],
    ["a rename, as one batch", [batch([propertySet("Foo", "Author", "Mira"), propertyRemoved("Foo", "Owner")])]],
    ["an edit then a delete, in one step", [blockEdited("a", "A!"), blockDeleted("a")]],
  ];
  for (const [name, events] of cases) roundTrip(name, events);
});

test("a deleted subtree comes back with its ids, in its place, and references find it again", () => {
  const { after, undone } = roundTrip("delete a", [blockDeleted("a")]);
  assert.equal(shape(after), "b(b1) c");
  assert.equal(shape(undone), "a(a1 a2) b(b1) c");
  assert.equal(getPage(undone, "Foo").blocks[0].children[0].text, "A1", "the block ((a1)) names");
});

test("an outdent that took siblings along goes back exactly", () => {
  const { after, undone } = roundTrip("outdent a1", [blockOutdented({ id: "a1", after: "a" })]);
  assert.equal(shape(after), "a a1(a2) b(b1) c");
  assert.equal(shape(undone), "a(a1 a2) b(b1) c");

  const three = fold(START, blockCreated("Foo", "A3", "a2", "a3", "a"));
  const taken = roundTrip("outdent a1 over two", [blockOutdented({ id: "a1", after: "a" })], three);
  assert.equal(shape(taken.after), "a a1(a2 a3) b(b1) c");
  assert.equal(shape(taken.undone), "a(a1 a2 a3) b(b1) c", "the siblings back in their order");
});

test("a deleted page comes back whole, spelled as it was", () => {
  const { undone } = roundTrip("delete Foo", [pageDeleted("foo")]);
  assert.equal(shape(undone), "a(a1 a2) b(b1) c");
  assert.deepEqual(get(undone.properties, "foo"), from([["owner", "Mira"]]));
  const inverse = inverseOf(START, [pageDeleted("foo")]);
  assert.ok(inverse.every((it) => (it.payload as { page: string }).page === "Foo"));
});

test("a step undone in reverse: the last event first", () => {
  const events = [blockEdited("a", "A!"), blockDeleted("a")];
  const inverse = inverseOf(START, events);
  assert.equal(inverse[0].type.endsWith("block.created"), true, "the delete is undone first");
  assert.deepEqual(inverse.at(-1), blockEdited("a", "A"), "then the edit");
  assert.equal(getPage(fold(fold(START, ...events), ...inverse), "Foo").blocks[0].text, "A");
});

test("what changed nothing has no inverse", () => {
  const cases: [string, Batched[]][] = [
    ["an edit to a block that is not there", [blockEdited("gone", "x")]],
    ["an edit to the text it has", [blockEdited("a", "A")]],
    ["a delete of a block that is not there", [blockDeleted("gone")]],
    ["a tag the page has", [tagAdded("Foo", "work")]],
    ["a tag it lacks, removed", [tagRemoved("Foo", "Home")]],
    ["an alias it has", [aliasAdded("Foo", "f")]],
    ["the value a property has", [propertySet("Foo", "Owner", "Mira")]],
    ["a property it lacks, removed", [propertyRemoved("Foo", "Nothing")]],
    ["a delete of a page with nothing on it", [pageDeleted("Empty")]],
    ["an outdent of a top-level block", [blockOutdented({ id: "a", after: "c" })]],
    ["no events", []],
  ];
  for (const [name, events] of cases) assert.deepEqual(invert(START, events), [], name);
});

// ── holds ───────────────────────────────────────────────────────────────────

/**
 * A step on `START`: the graph right after it, for the tests to write on,
 * and the step as main would remember it, which keeps no graph (#242).
 */
function step(...events: Batched[]) {
  return { after: fold(START, ...events), remembered: remember(START, events) };
}

test("a step holds right after it, and after a change to something it did not touch", () => {
  const steps = [
    step(blockEdited("b", "B!")),
    step(blockCreated("Foo", "N", undefined, "n")),
    step(blockDeleted("a")),
    step(blockIndented({ id: "b", parent: "a" })),
    step(blockOutdented({ id: "a1", after: "a" })),
    step(propertySet("Foo", "Owner", "Sal")),
    step(tagAdded("Foo", "Home")),
    step(aliasRemoved("Foo", "F")),
    step(pageDeleted("Foo")),
  ];
  for (const it of steps) {
    assert.equal(holds(it.after, it.remembered), true);
    const elsewhere = fold(it.after, blockEdited("x", "elsewhere"), propertySet("Bar", "k", "v"));
    assert.equal(holds(elsewhere, it.remembered), true);
  }
});

test("a step does not hold once another writer changed what it touched", () => {
  const cases: [string, ReturnType<typeof step>, Batched[]][] = [
    ["an edit, edited again", step(blockEdited("b", "B!")), [blockEdited("b", "theirs")]],
    ["an edit, the block deleted", step(blockEdited("b", "B!")), [blockDeleted("b")]],
    [
      "a creation, written under",
      step(blockCreated("Foo", "N", undefined, "n")),
      [blockCreated("Foo", "theirs", undefined, "t", "n")],
    ],
    [
      "a creation, edited",
      step(blockCreated("Foo", "N", undefined, "n")),
      [blockEdited("n", "theirs")],
    ],
    [
      "an indent, a sibling written after it",
      step(blockIndented({ id: "b", parent: "a" })),
      [blockCreated("Foo", "theirs", "b", "t", "a")],
    ],
    [
      "an outdent, a sibling it took along moved",
      step(blockOutdented({ id: "a1", after: "a" })),
      [blockOutdented({ id: "a2", after: "a1" })],
    ],
    [
      "a delete, the block back from elsewhere",
      step(blockDeleted("a")),
      [blockCreated("Foo", "A", undefined, "a1")],
    ],
    ["a property, set again", step(propertySet("Foo", "Owner", "Sal")), [propertySet("Foo", "owner", "Ana")]],
    ["a tag, removed again", step(tagAdded("Foo", "Home")), [tagRemoved("Foo", "home")]],
    ["an alias, added back", step(aliasRemoved("Foo", "F")), [aliasAdded("Foo", "F")]],
    [
      "a page delete, one of its blocks back",
      step(pageDeleted("Foo")),
      [blockCreated("Foo", "B", undefined, "b")],
    ],
  ];
  for (const [name, it, theirs] of cases) {
    assert.equal(holds(fold(it.after, ...theirs), it.remembered), false, name);
  }
});

test("an edit still holds when its block was moved, and a page delete when the page gained a block", () => {
  const edit = step(blockEdited("b", "B!"));
  assert.equal(holds(fold(edit.after, blockIndented({ id: "b", parent: "a" })), edit.remembered), true);
  const gone = step(pageDeleted("Foo"));
  assert.equal(
    holds(fold(gone.after, blockCreated("Foo", "new", undefined, "z")), gone.remembered),
    true,
  );
});

test("an undo is remembered as a step of its own, and undoing it is the redo", () => {
  const done = step(blockDeleted("a"));
  const inverse = done.remembered.inverse;
  assert.ok(inverse);
  const undone = fold(done.after, ...inverse);
  const undo = remember(done.after, inverse);
  assert.equal(holds(undone, undo), true);
  assert.equal(holds(fold(undone, blockEdited("a1", "theirs")), undo), false);
  assert.ok(undo.inverse);
  assert.deepEqual(held(fold(undone, ...undo.inverse)), held(done.after), "redone");
});

test("what remember keeps: the inverse invert gives, and a value per reading", () => {
  const events = [blockEdited("b", "B!"), tagAdded("Foo", "Home")];
  const remembered = remember(START, events);
  assert.deepEqual(remembered.inverse, invert(START, events));
  assert.equal(remembered.expected.length, 2);
  const nothing = remember(START, [blockEdited("gone", "x")]);
  assert.deepEqual([nothing.inverse, nothing.expected], [[], []], "a step that changed nothing");
});

test("every remembered value is a plain value, compared with ===", () => {
  const plain = (value: unknown) =>
    value === undefined || ["string", "number", "boolean"].includes(typeof value);
  for (const events of [
    [blockCreated("Foo", "N", undefined, "n")],
    [blockEdited("b", "B!")],
    [blockDeleted("a")],
    [blockIndented({ id: "b", parent: "a" })],
    [blockOutdented({ id: "a1", after: "a" })],
    [propertySet("Foo", "Owner", "Sal")],
    [propertyRemoved("Foo", "Owner")],
    [tagAdded("Foo", "Home")],
    [tagRemoved("Foo", "Work")],
    [aliasAdded("Foo", "G")],
    [aliasRemoved("Foo", "F")],
    [pageDeleted("Foo")],
  ]) {
    const { expected } = remember(START, events);
    assert.ok(expected.length > 0, events[0].type);
    for (const [, value] of expected) assert.ok(plain(value), `${events[0].type}: ${typeof value}`);
  }
});

/**
 * Whether `value` holds `target` anywhere inside it, through objects, arrays
 * and Maps. Functions are not looked inside: a reading is one, and what it
 * closes over is not reachable from here.
 */
function reaches(value: unknown, target: object, seen = new Set<unknown>()): boolean {
  if (value === target) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  const inside = value instanceof Map ? [...value.keys(), ...value.values()] : Object.values(value);
  return inside.some((it) => reaches(it, target, seen));
}

test("a remembered step holds no graph, neither the one before it nor the one after", () => {
  const events = [blockDeleted("a"), propertySet("Foo", "Owner", "Sal")];
  const after = fold(START, ...events);
  const remembered = remember(START, events);
  for (const graph of [START, after]) {
    for (const part of [graph, graph.forest, graph.texts, graph.properties, graph.titles, graph.tags]) {
      assert.equal(reaches(remembered, part), false);
    }
  }
});

test("every event type but batch has an undo entry, and only those", () => {
  const types = Object.keys(HANDLES).filter((type) => type !== `${NAMESPACE}batch`);
  assert.deepEqual(Object.keys(UNDO).sort(), types.sort());
});

test("an indent anywhere but under the sibling above is undone by moving it back (#252)", () => {
  // `c`'s sibling above is `b`: under `a` is not an indent a command writes.
  const elsewhere = blockIndented({ id: "c", parent: "a" });
  roundTrip("alone", [elsewhere]);
  roundTrip("with another event", [tagAdded("Foo", "Play"), elsewhere]);
  roundTrip("in a batch", [batch([tagAdded("Foo", "Play"), elsewhere])]);
});

// ── The generic walk, over a fold that knows nothing of the graph ───────────

/** A counter: `add` adds its payload, `stuck` adds 1 and cannot be undone. */
type Count = { n: number };
const add = (n: number): Batched => ({ type: "add", v: 1, payload: n });
const stuck: Batched = { type: "stuck", v: 1, payload: null };
const count = (state: Count, event: Batched): Count =>
  event.type === "add" && event.payload !== 0
    ? { n: state.n + (event.payload as number) }
    : event.type === "stuck"
      ? { n: state.n + 1 }
      : state;
const adding: Undo<Count> = {
  inverse: (_, event) => [add(-(event.payload as number))],
  touched: () => [same((it: Count) => it.n)],
};
const TABLE: UndoTable<Count> = { add: adding, stuck: CANNOT };

test("the walk undoes in reverse, and passes over what changed nothing", () => {
  assert.deepEqual(invertWith(count, TABLE, { n: 0 }, [add(2), add(0), add(5)]), [add(-5), add(-2)]);
  assert.deepEqual(invertWith(count, TABLE, { n: 0 }, [add(0)]), []);
});

test("one event that cannot be undone, or that has no entry, makes the whole step undefined", () => {
  assert.equal(invertWith(count, TABLE, { n: 0 }, [add(2), stuck]), undefined);
  assert.equal(invertWith(count, { stuck: CANNOT }, { n: 0 }, [add(2)]), undefined, "no entry");
});

test("a step is remembered once, and holds while what it touched is as it left it", () => {
  const remembered = rememberWith(count, TABLE, { n: 0 }, [add(2)]);
  assert.deepEqual(remembered.inverse, [add(-2)]);
  assert.deepEqual(
    remembered.expected.map(([, value]) => value),
    [2],
    "read on the state after the step",
  );
  assert.equal(holdsWith({ n: 2 }, remembered), true);
  assert.equal(holdsWith({ n: 3 }, remembered), false);
  assert.equal(rememberWith(count, TABLE, { n: 0 }, [add(2), stuck]).inverse, undefined);
});
