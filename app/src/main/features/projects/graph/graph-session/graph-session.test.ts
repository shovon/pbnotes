/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockEdited, blockIndented, blocksOn, getDeletions, graphFold, listPages } from "@pbnotes/graph";
import type { Batched, Graph } from "@pbnotes/graph";
import { createGraphSession } from "./graph-session.ts";
import { createHistory, stepOf } from "../history/history.ts";
import type { History } from "../history/history.ts";
import type { GraphView } from "./graph-session.ts";

/** Every page, by title, with its blocks: in title order, so a test can read them in order. */
const pagesOf = (graph: Graph) => listPages(graph).map(({ title }) => [title, blocksOn(graph, title)] as const);

/**
 * A ledger held in memory: the real fold, a version that moves with it as
 * `ledgers.ts`'s does, and a `dispatch` that waits on a gate a test can hold
 * shut, so a write can be kept in flight. `arrive` stands in for another
 * device's event landing.
 */
function ledger() {
  let state = graphFold.initial;
  let version = 0;
  let gate: Promise<void> = Promise.resolve();
  /** How many times this session wrote: one record each. */
  let writes = 0;
  const fold = (event: { type: string; v: number; payload: unknown }) => {
    state = graphFold.reduce(state, event);
    version++;
  };
  const view: GraphView = {
    get state() {
      return state;
    },
    get version() {
      return version;
    },
    status: { devices: [], ignored: [] },
    async dispatch(v, type, payload) {
      await gate;
      writes++;
      fold({ type, v, payload });
    },
  };
  /** Holds every dispatch until the returned function is called. */
  const hold = () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    return release;
  };
  /** Every top-level block's text, page by page. */
  const texts = () =>
    pagesOf(state).flatMap(([, blocks]) =>
      blocks.map((block) => block.text),
    );
  return { view, hold, texts, arrive: fold, writes: () => writes };
}

/**
 * The composition root for these tests: what is open is whichever ledger a
 * test says, read the moment `require` is called — as `requireProject` reads
 * it — and refused when there is none. Every version told is kept.
 */
function session(first: GraphView | null, history?: History<GraphView>) {
  let current = first;
  const told: number[] = [];
  const graph = createGraphSession(
    {
      async require() {
        const view = current;
        await Promise.resolve();
        if (!view) throw new Error("not reachable");
        return view;
      },
    },
    (version) => told.push(version),
    history,
  );
  return {
    graph,
    told,
    openLedger: (view: GraphView | null): void => {
      current = view;
    },
  };
}

const TODAY = "2026-10-27";
const shown = (view: { showing: { page: { blocks: { text: string }[] } }[] }) =>
  view.showing.flatMap(({ page }) => page.blocks.map((block) => block.text));

test("a write replies with the version the fold reached", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  assert.equal(await graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" }), 1);
  assert.equal(await graph.run({ type: "editBlock", blockId: "a1", text: "two" }), 2);
  // An indent with nowhere to go changes nothing, and names the version held.
  assert.equal(await graph.run({ type: "indentBlock", blockId: "a1" }), 2);
});

test("a view holds every write up to the version it reports", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  const v = await graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const seen = await graph.view(undefined, TODAY);
  assert.equal(seen.version, v);
  assert.deepEqual(shown(seen), ["one"]);
});

test("an arrival moves the version as a write does", async () => {
  const { view, arrive } = ledger();
  const { graph } = session(view);
  await graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const before = (await graph.view(undefined, TODAY)).version;
  arrive(blockEdited("a1", "from elsewhere"));
  const after = await graph.view(undefined, TODAY);
  assert.ok(after.version > before);
  assert.deepEqual(shown(after), ["from elsewhere"]);
});

test("the view is the journal with today on top, or the one page asked for", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  // Nothing written: today is there anyway, empty.
  const empty = await graph.view(undefined, TODAY);
  assert.deepEqual(empty.showing.map(({ page }) => [page.title, page.blocks.length]), [[TODAY, 0]]);
  await graph.run({ type: "addBlock", id: "a1", title: "Mira", text: "hi" });
  const page = await graph.view({ page: "Mira" }, TODAY);
  assert.deepEqual(page.showing.map(({ page }) => page.title), ["Mira"]);
  // Zoomed, what links to the page is not shown.
  const zoomed = await graph.view({ page: "Mira", block: "a1" }, TODAY);
  assert.deepEqual(zoomed.showing[0].references, []);
});

test("refreshing tells the windows the version, and nothing when nothing is reachable", async () => {
  const { view } = ledger();
  const { graph, told, openLedger } = session(view);
  await graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  graph.refreshGraph();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(told, [1]);
  openLedger(null);
  graph.refreshGraph();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(told, [1]);
  await assert.rejects(graph.view(undefined, TODAY), /not reachable/);
});

test("writes are recorded in the order they arrive, so one may name the block before it", async () => {
  const a = ledger();
  const { graph } = session(a.view);
  const release = a.hold();
  // Sent back to back, as Enter then typing does: the second names the first,
  // which is not on the page until the first has been written.
  const first = graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const second = graph.run({ type: "addBlock", id: "a2", title: TODAY, text: "two", after: "a1" });
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(a.texts(), ["one", "two"]);
});

test("a refused write does not hold up the ones behind it", async () => {
  const { view, texts } = ledger();
  const { graph } = session(view);
  const refused = graph.run({ type: "editBlock", blockId: "nope", text: "text" });
  const next = graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  await assert.rejects(refused, /No such block/);
  await next;
  assert.deepEqual(texts(), ["one"]);
});

test("a write lands where it was sent, even when what is open changes while it waits", async () => {
  const a = ledger();
  const b = ledger();
  const { graph, openLedger } = session(a.view);
  const release = a.hold();
  const first = graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const second = graph.run({ type: "addBlock", id: "a2", title: TODAY, text: "two", after: "a1" });
  openLedger(b.view);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(a.texts(), ["one", "two"]);
  assert.deepEqual(b.texts(), []);
});

test("with nothing reachable, a write is refused", async () => {
  const { graph } = session(null);
  await assert.rejects(graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" }), /not reachable/);
});

test("run reaches each block command, and records them in the order they arrived", async () => {
  const { view, hold } = ledger();
  const { graph } = session(view);
  const release = hold();
  const writes = [
    graph.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" }),
    graph.run({ type: "addBlock", id: "a2", title: TODAY, text: "two", after: "a1" }),
    graph.run({ type: "indentBlock", blockId: "a2" }),
    graph.run({ type: "editBlock", blockId: "a2", text: "two!" }),
    graph.run({ type: "outdentBlock", blockId: "a2" }),
    graph.run({ type: "addBlock", id: "a3", title: TODAY, text: "three", after: "a2" }),
    graph.run({ type: "deleteBlock", blockId: "a1" }),
  ];
  release();
  await Promise.all(writes);
  assert.deepEqual(shown(await graph.view(undefined, TODAY)), ["two!", "three"]);
});

test("property writes are recorded in order with the block writes around them", async () => {
  const { view, hold } = ledger();
  const { graph } = session(view);
  const release = hold();
  const writes = [
    graph.run({ type: "addBlock", id: "a1", title: "Mira", text: "hi" }),
    graph.run({ type: "setProperty", title: "Mira", key: "Owner", value: "Sal" }),
    graph.run({ type: "renameProperty", title: "Mira", from: "Owner", to: "Author" }),
    graph.run({ type: "editBlock", blockId: "a1", text: "hello" }),
    graph.run({ type: "setProperty", title: "Mira", key: "Status", value: "done" }),
    graph.run({ type: "removeProperty", title: "Mira", key: "Status" }),
  ];
  release();
  await Promise.all(writes);
  const seen = await graph.view({ page: "Mira" }, TODAY);
  assert.deepEqual(shown(seen), ["hello"]);
  assert.deepEqual(seen.showing[0].properties, [{ key: "Author", value: "Sal" }]);
});

test("tag writes are recorded in order with the block writes around them", async () => {
  const { view, hold } = ledger();
  const { graph } = session(view);
  const release = hold();
  const writes = [
    graph.run({ type: "addBlock", id: "a1", title: "Mira", text: "hi" }),
    graph.run({ type: "addTag", title: "Mira", tag: "Work" }),
    graph.run({ type: "addTag", title: "Mira", tag: "Home" }),
    graph.run({ type: "editBlock", blockId: "a1", text: "hello" }),
    graph.run({ type: "removeTag", title: "mira", tag: "home" }),
    graph.run({ type: "addTag", title: "Atlas", tag: "Mira" }),
  ];
  release();
  await Promise.all(writes);
  const seen = await graph.view({ page: "Mira" }, TODAY);
  assert.deepEqual(shown(seen), ["hello"]);
  assert.deepEqual(seen.showing[0].tags, ["Work"]);
  assert.deepEqual(seen.showing[0].taggedBy, ["Atlas"]);
});

test("a refused rename writes nothing and does not hold up the writes behind it", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  await graph.run({ type: "setProperty", title: "Mira", key: "Owner", value: "Sal" });
  await graph.run({ type: "setProperty", title: "Mira", key: "Author", value: "Kim" });
  const before = (await graph.view({ page: "Mira" }, TODAY)).version;
  await assert.rejects(
    graph.run({ type: "renameProperty", title: "Mira", from: "Owner", to: "author" }),
  );
  assert.equal((await graph.view({ page: "Mira" }, TODAY)).version, before);
  await graph.run({ type: "removeProperty", title: "Mira", key: "Owner" });
  assert.deepEqual((await graph.view({ page: "Mira" }, TODAY)).showing[0].properties, [
    { key: "Author", value: "Kim" },
  ]);
});

test("find lists the matching titles, then the matching blocks with their page", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  await graph.run({ type: "addBlock", id: "m1", title: "Mira", text: "her page" });
  await graph.run({ type: "addBlock", id: "d1", title: TODAY, text: "Call [[Mira]]" });
  assert.deepEqual(await graph.find("mira"), {
    pages: [{ title: "Mira", opens: "Mira" }],
    blocks: [{ id: "d1", page: TODAY, text: "Call Mira" }],
  });
});

test("a page delete is recorded in order with the writes around it", async () => {
  const { view, hold } = ledger();
  const { graph } = session(view);
  const release = hold();
  const writes = [
    graph.run({ type: "addBlock", id: "a1", title: "Mira", text: "gone" }),
    graph.run({ type: "setProperty", title: "Mira", key: "Owner", value: "Sal" }),
    graph.run({ type: "deletePage", title: "mira" }),
    graph.run({ type: "addBlock", id: "a2", title: "Mira", text: "after" }),
  ];
  release();
  await Promise.all(writes);
  const seen = await graph.view({ page: "Mira" }, TODAY);
  assert.deepEqual(shown(seen), ["after"]);
  assert.deepEqual(seen.showing[0].properties, []);
  assert.equal(seen.showing[0].deletions, 1);
});

test("deleting a page with nothing on it writes nothing", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  const before = view.version;
  assert.equal(await graph.run({ type: "deletePage", title: "Mira" }), before);
});

test("a page's own view counts the refs other graph hold to its blocks", async () => {
  const { view } = ledger();
  const { graph } = session(view);
  await graph.run({ type: "addBlock", id: "a1", title: "Mira", text: "here" });
  await graph.run({ type: "addBlock", id: "a2", title: TODAY, text: "[[Mira]] ((a1))" });
  await graph.run({ type: "addBlock", id: "a3", title: TODAY, text: "((a1))" });
  const own = (await graph.view({ page: "Mira" }, TODAY)).showing[0];
  assert.equal(own.refsTo, 2);
  // The one block linking here, counted before any is loaded (#285).
  assert.equal(own.links, 1);
  // Not walked where no delete is offered.
  assert.equal((await graph.view({ page: "Mira", block: "a1" }, TODAY)).showing[0].refsTo, 0);
  assert.ok((await graph.view(undefined, TODAY)).showing.every((it) => it.refsTo === 0));
});

// ── Undo and redo (#234) ────────────────────────────────────────────────────

/**
 * What undo puts back: what the user wrote, not spellings, counts or dates.
 * A page with no blocks is left out: every page is in the graph, and one
 * whose last block moved away again is the same as one never written.
 */
const held = (graph: Graph) => ({
  blocks: new Map(pagesOf(graph).filter(([, it]) => it.length > 0)),
  properties: graph.properties,
  tags: graph.tags,
  aliases: graph.aliases,
});

/** Ids for the blocks the tests write. */
const A = "a1";
const B = "b1";
const C = "c1";

/**
 * `Foo` with `a1` holding `b1` under it and `c1` after it, a property, a tag
 * and an alias-free page `Bar`: something every command can change.
 */
async function written() {
  const it = ledger();
  const { graph, openLedger } = session(it.view);
  for (const command of [
    { type: "addBlock", id: A, title: "Foo", text: "A" },
    { type: "addBlock", id: B, title: "Foo", text: "B", after: A },
    { type: "indentBlock", blockId: B },
    { type: "addBlock", id: C, title: "Foo", text: "C", after: A },
    { type: "setProperty", title: "Foo", key: "Owner", value: "Mira" },
    { type: "addTag", title: "Foo", tag: "Work" },
    { type: "addBlock", id: "d1", title: "Bar", text: "D" },
  ] as const) {
    await graph.run(command);
  }
  return { ...it, graph, openLedger };
}

/** Undo and redo of every command undoes back to where it started, and redoes forward. */
test("every command is undone to the graph before it, and redone to the graph after", async () => {
  const commands = [
    { type: "addBlock", id: "n1", title: "Foo", text: "new", after: C },
    { type: "editBlock", blockId: C, text: "C!" },
    { type: "deleteBlock", blockId: A },
    { type: "deleteBlocks", blockIds: [C, A, "d1"] },
    { type: "indentBlocks", blockIds: [C] },
    { type: "outdentBlocks", blockIds: [B] },
    { type: "indentBlock", blockId: C },
    { type: "outdentBlock", blockId: B },
    { type: "moveBlock", blockId: A, title: "Bar", after: "d1" },
    { type: "moveBlock", blockId: C, title: "Foo", parent: A },
    { type: "moveBlock", blockId: C, title: "Never written", first: true },
    { type: "moveBlocks", blockIds: [C, A], title: "Bar", after: "d1" },
    { type: "moveBlocks", blockIds: [C, "d1"], title: "Never written" },
    { type: "setProperty", title: "Foo", key: "Owner", value: "Sal" },
    { type: "removeProperty", title: "Foo", key: "Owner" },
    { type: "renameProperty", title: "Foo", from: "Owner", to: "Author" },
    { type: "addTag", title: "Foo", tag: "Home" },
    { type: "removeTag", title: "Foo", tag: "Work" },
    { type: "deletePage", title: "Foo" },
  ] as const;
  for (const command of commands) {
    const { graph, view } = await written();
    const before = held(view.state);
    await graph.run(command);
    const after = held(view.state);
    assert.notDeepEqual(after, before, `${command.type} changes something`);
    const undone = await graph.run({ type: "undo" });
    assert.equal(undone.result, "done", command.type);
    assert.equal(undone.version, view.version, `${command.type}: the version after`);
    assert.deepEqual(held(view.state), before, `${command.type} undone`);
    assert.equal((await graph.run({ type: "redo" })).result, "done", command.type);
    assert.deepEqual(held(view.state), after, `${command.type} redone`);
  }
});

test("undoing a delete writes one record, and says where it was", async () => {
  const { graph, view, writes } = await written();
  await graph.run({ type: "deleteBlock", blockId: A });
  const before = writes();
  const undone = await graph.run({ type: "undo" });
  assert.equal(writes(), before + 1, "one batch");
  assert.deepEqual(undone, { version: view.version, result: "done", page: "Foo", block: A });
  assert.deepEqual(
    (blocksOn(view.state, "foo")).map((it) => it.id),
    [A, C],
    "back in its place, its child with it",
  );
  await graph.run({ type: "deletePage", title: "Bar" });
  const page = await graph.run({ type: "undo" });
  assert.deepEqual([page.result, page.page, page.block], ["done", "Bar", undefined]);
});

test("deleting several blocks, across pages, is one step that one undo brings back (#258)", async () => {
  const { graph, view, writes } = await written();
  const shape = () =>
    ["foo", "bar"].map((page) => blocksOn(view.state, page).map((it) => it.id).join(" "));
  const start = shape();
  const before = writes();
  // `b1` is under `a1`, and goes with it.
  await graph.run({ type: "deleteBlocks", blockIds: [B, A, C, "d1"] });
  assert.equal(writes(), before + 1, "one record");
  assert.deepEqual(shape(), ["", ""]);
  const undone = await graph.run({ type: "undo" });
  assert.deepEqual([undone.result, undone.page, undone.block], ["done", "Foo", A]);
  assert.deepEqual(shape(), start, "every block back where it was");
  assert.equal((blocksOn(view.state, "foo"))[0]?.children[0]?.id, B, "the child under its parent");
  assert.equal((await graph.run({ type: "undo" })).result, "done", "the step before it, not more of this one");
});

test("a Tab with one block that cannot indent, on any page, writes nothing and is no step (#259)", async () => {
  const { graph, view, writes } = await written();
  const before = writes();
  // `c1` can go under `a1`, but `d1` is first on `Bar`.
  await graph.run({ type: "indentBlocks", blockIds: [C, "d1"] });
  assert.equal(writes(), before, "nothing written");
  assert.equal((blocksOn(view.state, "foo")).at(-1)?.id, C, "c1 where it was");
  const undone = await graph.run({ type: "undo" });
  assert.notEqual(undone.block, C, "undo takes the step before, not a Tab that did nothing");
});

test("a Shift+Tab with one block already top-level, on any page, writes nothing and is no step (#260)", async () => {
  const { graph, view, writes } = await written();
  const before = writes();
  // `b1` can come out from under `a1`, but `d1` is top-level on `Bar`.
  await graph.run({ type: "outdentBlocks", blockIds: [B, "d1"] });
  assert.equal(writes(), before, "nothing written");
  assert.equal((blocksOn(view.state, "foo"))[0]?.children[0]?.id, B, "b1 where it was");
  const undone = await graph.run({ type: "undo" });
  assert.notEqual(undone.block, B, "undo takes the step before, not a Shift+Tab that did nothing");
});

test("a move takes the block and its subtree to another page, keeping its id (#251)", async () => {
  const { graph } = await written();
  await graph.run({ type: "moveBlock", blockId: A, title: "Bar", after: "d1" });
  const bar = (await graph.view({ page: "Bar" }, TODAY)).showing[0].page;
  assert.deepEqual(
    bar.blocks.map((it) => [it.id, it.children.map((child) => child.id)]),
    [["d1", []], [A, [B]]],
  );
  const foo = (await graph.view({ page: "Foo" }, TODAY)).showing[0].page;
  assert.deepEqual(foo.blocks.map((it) => it.id), [C]);
});

test("a selection moved across pages is one record and one undo step (#269)", async () => {
  const { graph, view, writes } = await written();
  const before = held(view.state);
  const count = writes();
  await graph.run({ type: "moveBlocks", blockIds: [C, "d1"], title: "Foo", parent: A });
  assert.equal(writes(), count + 1);
  const foo = (await graph.view({ page: "Foo" }, TODAY)).showing[0].page;
  assert.deepEqual(
    foo.blocks.map((it) => [it.id, it.children.map((child) => child.id)]),
    [[A, [C, "d1", B]]],
  );
  assert.equal((await graph.run({ type: "undo" })).result, "done");
  assert.deepEqual(held(view.state), before);
});

test("a move onto a page nothing was written on is its first write (#251)", async () => {
  const { graph } = await written();
  await graph.run({ type: "moveBlock", blockId: C, title: "2026-11-01" });
  const day = (await graph.view({ page: "2026-11-01" }, TODAY)).showing[0].page;
  assert.deepEqual(day.blocks.map((it) => it.id), [C]);
});

test("a move into the block's own subtree is refused and writes nothing (#251)", async () => {
  const { graph, writes } = await written();
  const before = writes();
  await assert.rejects(graph.run({ type: "moveBlock", blockId: A, title: "Foo", parent: B }));
  assert.equal(writes(), before);
});

test("a move to where the block already is writes nothing and is no step (#251)", async () => {
  const { graph, writes } = await written();
  const before = writes();
  await graph.run({ type: "moveBlock", blockId: C, title: "Foo", after: A });
  assert.equal(writes(), before);
});

test("redoing a page delete deletes the page again, not its blocks one by one", async () => {
  const { graph, view } = await written();
  await graph.run({ type: "deletePage", title: "Foo" });
  const deleted = getDeletions(view.state, "foo");
  await graph.run({ type: "undo" });
  await graph.run({ type: "redo" });
  assert.equal(getDeletions(view.state, "foo"), deleted + 1, "a page delete, counted");
  assert.deepEqual(blocksOn(view.state, "foo"), [], "and nothing left on it");
});

test("undo goes back step by step, last first", async () => {
  const { graph, texts } = await written();
  await graph.run({ type: "editBlock", blockId: C, text: "one" });
  await graph.run({ type: "editBlock", blockId: C, text: "two" });
  await graph.run({ type: "undo" });
  assert.ok(texts().includes("one"));
  await graph.run({ type: "undo" });
  assert.ok(texts().includes("C"));
});

test("another session's edit stops undo there, leaves their text, and lets undo on once it is gone", async () => {
  const { graph, view, arrive, writes, texts } = await written();
  await graph.run({ type: "editBlock", blockId: A, text: "A!" });
  await graph.run({ type: "editBlock", blockId: C, text: "mine" });
  arrive(blockEdited(C, "theirs"));
  const before = writes();
  const stopped = await graph.run({ type: "undo" });
  assert.deepEqual(stopped, { version: view.version, result: "changed", page: "Foo", block: C });
  assert.equal((await graph.run({ type: "undo" })).result, "changed", "still");
  assert.equal(writes(), before, "nothing written");
  assert.ok(texts().includes("theirs") && texts().includes("A!"), "theirs kept, the step before never undone");
  arrive(blockEdited(C, "mine"));
  assert.equal((await graph.run({ type: "undo" })).result, "done");
  assert.ok(texts().includes("C"));
});

test("an event from another session is never undone", async () => {
  const { graph, arrive, texts } = await written();
  arrive(blockEdited(C, "theirs"));
  // The last step this session wrote is the tag on `Bar`'s block, not theirs.
  const undone = await graph.run({ type: "undo" });
  assert.equal(undone.page, "Bar");
  assert.ok(texts().includes("theirs"));
});

test("a step that cannot be undone stops undo there; one after it still undoes, down to it", async () => {
  const it = ledger();
  const history = createHistory<GraphView>();
  const { graph } = session(it.view, history);
  await graph.run({ type: "addBlock", id: A, title: "Foo", text: "A" });
  await graph.run({ type: "addBlock", id: B, title: "Foo", text: "B", after: A });
  await graph.run({ type: "addBlock", id: C, title: "Foo", text: "C", after: B });
  // No event is impossible to undo since #252, so the step is made one by
  // hand, as an event whose module says `undo: "cannot"` would make it.
  // Written as if another writer had, and kept as this session's step.
  const before = it.view.state;
  const stuck = blockIndented({ id: C, parent: B });
  it.arrive(stuck);
  const made = stepOf(before, it.view.state, [stuck]);
  assert.ok(made);
  const entry = { ...made, remembered: { ...made.remembered, inverse: undefined as Batched[] | undefined } };
  history.record(it.view, entry);
  await graph.run({ type: "editBlock", blockId: B, text: "B!" });
  assert.equal((await graph.run({ type: "undo" })).result, "done", "the step after it");
  const writes = it.writes();
  const cannot = await graph.run({ type: "undo" });
  assert.deepEqual([cannot.result, cannot.page, cannot.block], ["cannot", "Foo", C]);
  assert.equal((await graph.run({ type: "undo" })).result, "cannot", "still");
  assert.equal(it.writes(), writes, "nothing written");
  assert.ok(it.texts().includes("A"), "the steps before it are never undone");
});

test("a new step after an undo clears redo", async () => {
  const { graph } = await written();
  await graph.run({ type: "editBlock", blockId: C, text: "C!" });
  await graph.run({ type: "undo" });
  await graph.run({ type: "editBlock", blockId: A, text: "A!" });
  assert.equal((await graph.run({ type: "redo" })).result, "nothing");
});

test("undo and redo with nothing to do write nothing, and name the version held", async () => {
  const it = ledger();
  const { graph } = session(it.view);
  assert.deepEqual(await graph.run({ type: "undo" }), { version: 0, result: "nothing" });
  assert.deepEqual(await graph.run({ type: "redo" }), { version: 0, result: "nothing" });
  assert.equal(it.writes(), 0);
});

test("a write that changed nothing is not a step", async () => {
  const { graph, texts } = await written();
  await graph.run({ type: "editBlock", blockId: C, text: "C!" });
  // `a1` is first among its siblings: nowhere to indent, nothing written.
  await graph.run({ type: "indentBlock", blockId: A });
  await graph.run({ type: "undo" });
  assert.ok(texts().includes("C"), "the undo reached the edit");
});

test("changing the open project forgets the history", async () => {
  const { graph } = await written();
  graph.forget();
  assert.equal((await graph.run({ type: "undo" })).result, "nothing");
});

test("a write queued for the project before a switch is never undone in the one after", async () => {
  const one = ledger();
  const two = ledger();
  const { graph, openLedger } = session(one.view);
  const release = one.hold();
  const queued = graph.run({ type: "addBlock", id: A, title: "Foo", text: "A" });
  openLedger(two.view);
  graph.forget();
  release();
  await queued;
  assert.equal((await graph.run({ type: "undo" })).result, "nothing", "the new project has no steps");
  assert.equal(two.writes(), 0);
  assert.deepEqual(one.texts(), ["A"]);
});

test("a refused write is not a step, and leaves undo where it was", async () => {
  const { graph, texts } = await written();
  await graph.run({ type: "editBlock", blockId: C, text: "C!" });
  await assert.rejects(graph.run({ type: "editBlock", blockId: "nope", text: "x" }));
  await graph.run({ type: "undo" });
  assert.ok(texts().includes("C"));
});
