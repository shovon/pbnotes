/**
 * Run with: npm test
 *
 * Deleting a page, through the gate, over a view that is nothing but an array.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBlock,
  blockCreated,
  blockEdited,
  deletePage,
  editBlock,
  getDeletions,
  getRefsTo,
  getPage,
  getProperties,
  indentBlock,
  NAMESPACE,
  pageDeleted,
  graphFold,
  propertySet,
  searchPages,
  setProperty,
} from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";

/** A view over a plain list of events, folded through the gate. */
function memory(): GraphView & { events: unknown[] } {
  const events: { type: string; v: number; payload: unknown }[] = [];
  let state: Graph = graphFold.initial;
  return {
    events,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      const event = { type, v, payload };
      events.push(event);
      state = graphFold.reduce(state, event);
    },
  };
}

const id = () => crypto.randomUUID();

/** `Foo` with a nested block and a property. */
async function foo(view: GraphView): Promise<{ parent: string; child: string }> {
  const parent = id();
  const child = id();
  await addBlock(view, "Foo", "parent", undefined, parent);
  await addBlock(view, "Foo", "child", parent, child);
  await indentBlock(view, child);
  await setProperty(view, "Foo", "Status", "draft");
  return { parent, child };
}

test("a delete empties the page's blocks and properties, and search drops it", async () => {
  const view = memory();
  await foo(view);
  await deletePage(view, "Foo");
  assert.deepEqual(getPage(view.state, "Foo").blocks, []);
  assert.deepEqual(getProperties(view.state, "Foo"), []);
  assert.ok(!searchPages(view.state, "Foo").includes("Foo"));
  assert.equal(view.events.length, 5);
});

test("a page another page links to stays in search, empty, until the link goes", async () => {
  const view = memory();
  await foo(view);
  const link = id();
  await addBlock(view, "Bar", "see [[foo]]", undefined, link);
  await deletePage(view, "Foo");
  assert.deepEqual(getPage(view.state, "Foo").blocks, []);
  assert.deepEqual(getProperties(view.state, "Foo"), []);
  // The first spelling the fold saw, not the link's.
  assert.ok(searchPages(view.state, "foo").includes("Foo"));
  await editBlock(view, link, "nothing now");
  assert.ok(!searchPages(view.state, "foo").includes("Foo"));
});

test("a link on the deleted page itself does not keep it alive", async () => {
  const view = memory();
  await addBlock(view, "Foo", "[[Foo]] and [[Baz]]", undefined, id());
  await deletePage(view, "Foo");
  assert.ok(!searchPages(view.state, "foo").includes("Foo"));
});

test("a block that sorts before the delete goes with it; one after it stands", () => {
  const early = id();
  const late = id();
  let state = graphFold.initial;
  for (const event of [
    blockCreated("Foo", "first", undefined, id()),
    // Written offline before the delete, arriving late: still before it in fold order.
    blockCreated("Foo", "early", undefined, early),
    pageDeleted("Foo"),
    blockCreated("Foo", "late", undefined, late),
  ]) {
    state = graphFold.reduce(state, event);
  }
  assert.deepEqual(
    getPage(state, "Foo").blocks.map((block) => block.id),
    [late],
  );
});

test("an edit after the delete, to a block it removed, changes nothing", () => {
  const block = id();
  let state = graphFold.initial;
  for (const event of [
    blockCreated("Foo", "before", undefined, block),
    pageDeleted("Foo"),
    blockEdited(block, "after"),
  ]) {
    state = graphFold.reduce(state, event);
  }
  assert.deepEqual(getPage(state, "Foo").blocks, []);
});

test("deleting a page with nothing on it appends nothing", async () => {
  const view = memory();
  await addBlock(view, "Bar", "see [[Foo]]", undefined, id());
  await deletePage(view, "Foo");
  await deletePage(view, "Nowhere");
  assert.equal(view.events.length, 1);
});

test("a page with only properties is deleted", async () => {
  const view = memory();
  await setProperty(view, "Foo", "Status", "draft");
  await deletePage(view, "Foo");
  assert.deepEqual(getProperties(view.state, "Foo"), []);
  assert.equal(view.events.length, 2);
});

test("deleting `foo` deletes `Foo`'s page", async () => {
  const view = memory();
  await foo(view);
  await deletePage(view, "foo");
  assert.deepEqual(getPage(view.state, "Foo").blocks, []);
  assert.deepEqual(getProperties(view.state, "FOO"), []);
});

test("the spelling stays when a link keeps the page alive", async () => {
  const view = memory();
  await foo(view);
  await addBlock(view, "Bar", "[[FOO]]", undefined, id());
  await deletePage(view, "foo");
  assert.equal(getPage(view.state, "fOo").title, "Foo");
});

test("each delete counts once, per page, by `canonicalize`", async () => {
  const view = memory();
  assert.equal(getDeletions(view.state, "Foo"), 0);
  await foo(view);
  await deletePage(view, "Foo");
  assert.equal(getDeletions(view.state, "foo"), 1);
  await addBlock(view, "Foo", "again", undefined, id());
  await deletePage(view, "FOO");
  assert.equal(getDeletions(view.state, "Foo"), 2);
  assert.equal(getDeletions(view.state, "Bar"), 0);
});

test("refs to the page's blocks are counted from other pages only, once per block", async () => {
  const view = memory();
  const { parent, child } = await foo(view);
  await addBlock(view, "Foo", `[[Foo]] ((${child}))`, undefined, id());
  const linker = id();
  await addBlock(view, "Bar", "[[Foo]]", undefined, linker);
  const nested = id();
  await addBlock(view, "Bar", "nested [[foo]] under a linker", linker, nested);
  await indentBlock(view, nested);
  await addBlock(view, "Bar", `((${parent})) and ((${child}))`, undefined, id());
  await addBlock(view, "Baz", `#Foo ((${child}))`, undefined, id());
  await addBlock(view, "Baz", `((${crypto.randomUUID()}))`, undefined, id());
  assert.equal(getRefsTo(view.state, "foo"), 2);
  assert.equal(getRefsTo(view.state, "Nowhere"), 0);
});

test("a malformed delete is skipped whole", () => {
  const state = graphFold.reduce(
    graphFold.initial,
    blockCreated("Foo", "x", undefined, id()),
  );
  for (const payload of [null, "Foo", {}, { page: 7 }, { page: "  " }]) {
    const event = { type: `${NAMESPACE}page.deleted`, v: 1, payload };
    assert.equal(graphFold.reduce(state, event), state, JSON.stringify(payload));
  }
});

test("a delete at a `v` this build does not read is skipped", () => {
  const state = graphFold.reduce(
    graphFold.initial,
    blockCreated("Foo", "x", undefined, id()),
  );
  const event = { ...pageDeleted("Foo"), v: 2 };
  assert.equal(graphFold.reduce(state, event), state);
});

test("a property set after the delete stands", () => {
  let state = graphFold.initial;
  for (const event of [
    propertySet("Foo", "Status", "draft"),
    pageDeleted("Foo"),
    propertySet("Foo", "Owner", "me"),
  ]) {
    state = graphFold.reduce(state, event);
  }
  assert.deepEqual(getProperties(state, "Foo"), [{ key: "Owner", value: "me" }]);
});
