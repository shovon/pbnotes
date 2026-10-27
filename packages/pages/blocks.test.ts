/**
 * Run with: npm test
 *
 * The fold on its own: one event in, the whole view out, with no log, no
 * device and no project directory anywhere near it. That this file needs none
 * of those is the point of `blocks.ts` being separate from `pages.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANDLES,
  indented,
  NAMESPACE,
  outdented,
  predict,
  reduce,
} from "./blocks.ts";
import { getPage, getReferences, searchPages } from "./pages.ts";
import type { Block, PageEvent, Pages } from "./blocks.ts";

const TODAY = "2026-09-21";

/** Nothing written yet. */
const empty = (): Pages => ({ blocks: {}, titles: {} });

/** One event, straight into `reduce`, with no log or device around it. */
function event(type: string, v: number, payload: unknown) {
  return {
    seq: 1,
    device: "d",
    hlc: { l: 1, c: 0 },
    id: "x",
    type,
    v,
    at: "2026-09-21T00:00:00.000Z",
    payload,
  };
}

test("the fold ignores events it does not know", async () => {
  const state = empty();
  assert.equal(reduce(state, event("something.else", 1, {})), state);
});

/**
 * The shape the first logs were written in: a page on the events that follow
 * a creation. Nothing reads it any more, so there is no upcast to
 * exercise — what has to hold is that the id alone still reaches the block,
 * which is the whole claim that made dropping the field safe. No write path
 * produces these any more, so this is the only thing that would notice if
 * `reduce` ever went back to looking a page up.
 */
test("a v1 payload still folds, page and all", async () => {
  const created = reduce(
    empty(),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "b1", text: "first" }),
  );
  const nested = reduce(
    reduce(
      created,
      event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "b2", text: "second" }),
    ),
    event(`${NAMESPACE}block.indented`, 1, { page: TODAY, id: "b2", parent: "b1" }),
  );
  const edited = reduce(
    nested,
    event(`${NAMESPACE}block.edited`, 1, { page: TODAY, id: "b2", text: "rewritten" }),
  );
  assert.deepEqual(edited.blocks[TODAY], [
    {
      id: "b1",
      text: "first",
      children: [{ id: "b2", text: "rewritten", children: [] }],
    },
  ]);

  // And the page on the event is not what found the block: a wrong one folds
  // the same way, where before it would have folded to nothing.
  const elsewhere = reduce(
    edited,
    event(`${NAMESPACE}block.edited`, 1, { page: "Mira", id: "b2", text: "again" }),
  );
  assert.equal(elsewhere.blocks[TODAY][0].children[0].text, "again");
  assert.deepEqual(Object.keys(elsewhere.blocks), [TODAY]);
});

/**
 * #40: an event has one name, the namespaced one. A bare name from a log
 * that was never rewritten (#39) is not folded and not claimed by the gate,
 * so it is reported to the user as one this build cannot read.
 */
test("an event is folded under its namespaced name and no other", () => {
  const payload = { page: TODAY, id: "b1", text: "first" };
  const none = empty();

  assert.deepEqual(reduce(none, event(`${NAMESPACE}block.created`, 1, payload)), {
    blocks: { [TODAY]: [{ id: "b1", text: "first", children: [] }] },
    titles: { [TODAY]: TODAY },
  });
  assert.equal(reduce(none, event("block.created", 1, payload)), none);
  // Only the exact prefix. A slash is what #37 first proposed and is not it.
  assert.equal(
    reduce(none, event("github.com/shovon/pbnotes/block.created", 1, payload)),
    none,
  );

  assert.equal(Object.keys(HANDLES).length, 5);
  assert.equal(Object.keys(HANDLES).every((type) => type.startsWith(NAMESPACE)), true);
});

test("a prediction is the fold, and folding it over a page that has it changes nothing", () => {
  const block = (id: string, text: string): Block => ({
    id,
    text,
    children: [],
  });
  const page = { title: TODAY, blocks: [block("a", "A"), block("b", "B")] };

  // Enter beneath A, Tab, then Shift+Tab: each move resolved on the page as
  // the events before it leave it, the way the renderer builds them.
  const create: PageEvent = {
    type: `${NAMESPACE}block.created`,
    payload: { page: TODAY, id: "n", text: "new", after: "a" },
  };
  const created = predict(page, [create]);
  assert.deepEqual(
    created.blocks.map((it) => it.id),
    ["a", "n", "b"],
  );

  const indent: PageEvent = {
    type: `${NAMESPACE}block.indented`,
    payload: indented(created.blocks, "n") ?? assert.fail(),
  };
  const under = predict(page, [create, indent]);
  assert.deepEqual(under.blocks[0].children.map((it) => it.id), ["n"]);
  // First among its siblings now: nowhere further in.
  assert.equal(indented(under.blocks, "n"), undefined);

  const outdent: PageEvent = {
    type: `${NAMESPACE}block.outdented`,
    payload: outdented(under.blocks, "n") ?? assert.fail(),
  };
  const out = predict(page, [create, indent, outdent]);
  assert.deepEqual(out, created);
  assert.equal(outdented(out.blocks, "n"), undefined);

  // Main's state arrives before the write is known to have settled, so each
  // of these is, for a moment, folded over a page that already holds it.
  assert.deepEqual(predict(created, [create]), created);
  assert.deepEqual(predict(under, [indent]), under);
  assert.deepEqual(predict(out, [outdent]), out);
});

/**
 * #62: a title is whatever was typed, so it can be the name of something
 * every object inherits. A fold that throws on one never gets past it, on
 * any machine, for as long as the log keeps the event.
 */
test("a page named after an Object.prototype property folds like any other", () => {
  for (const title of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const state = reduce(
      empty(),
      event(`${NAMESPACE}block.created`, 1, { page: title, id: "b1", text: "hi" }),
    );
    const key = title.toLowerCase();
    assert.deepEqual(state.blocks[key], [{ id: "b1", text: "hi", children: [] }], title);
    assert.deepEqual(Object.keys(state.blocks), [key], title);
    assert.equal(state.titles[key], title, title);
  }
});

/**
 * #62: two machines each indent one block under the other before they sync.
 * The second move would detach its own parent, so it folds to nothing, like
 * an indent whose parent is gone.
 */
test("an indent under itself or its own subtree changes nothing", () => {
  const indent = (id: string, parent: string) =>
    event(`${NAMESPACE}block.indented`, 2, { id, parent });
  const two = [
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "x", text: "x" }),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "y", text: "y" }),
  ].reduce(reduce, empty());

  assert.equal(reduce(two, indent("y", "y")), two);
  const nested = reduce(two, indent("y", "x"));
  assert.equal(reduce(nested, indent("x", "y")), nested);
});

/** A `PagesView` over a state, for the queries; nothing here writes. */
const view = (state: Pages) => ({ state, dispatch: async () => {} });

/**
 * #83: a link names a page before anything is written on it, and that is the
 * spelling the page keeps — through a creation in other case, and after the
 * link is edited away.
 */
test("a page keeps the first spelling that named it", () => {
  const created = (id: string, page: string, text: string) =>
    event(`${NAMESPACE}block.created`, 1, { page, id, text });
  const edited = (id: string, text: string) =>
    event(`${NAMESPACE}block.edited`, 2, { id, text });
  const state = [
    created("a", TODAY, "nothing yet"),
    edited("a", "see [[Nonexistent page]]"),
    created("b", "nonexistent page", "now something"),
    edited("a", "never mind"),
  ].reduce(reduce, empty());

  const page = getPage(view(state), "NONEXISTENT PAGE");
  assert.equal(page.title, "Nonexistent page");
  assert.deepEqual(page.blocks.map((it) => it.id), ["b"]);
});

/**
 * #83: `Mira`, `mira` and `#MIRA` are one page. Blocks filed under either
 * spelling land on it in the order they were written, which is also what an
 * existing ledger with both gets on its next open.
 */
test("titles that differ only in case are one page", () => {
  const created = (id: string, page: string, text: string) =>
    event(`${NAMESPACE}block.created`, 1, { page, id, text });
  const state = [
    created("m1", "Mira", "first"),
    created("d1", TODAY, "met #MIRA"),
    created("m2", "mira", "second"),
    created("d2", TODAY, "and [[mira]] again"),
  ].reduce(reduce, empty());

  const page = getPage(view(state), "mIRA");
  assert.equal(page.title, "Mira");
  assert.deepEqual(page.blocks.map((it) => it.id), ["m1", "m2"]);

  const references = getReferences(view(state), "mira");
  assert.deepEqual(references.map((it) => it.title), [TODAY]);
  assert.deepEqual(references[0].blocks.map((it) => it.id), ["d1", "d2"]);

  assert.deepEqual(searchPages(view(state), "mi"), ["Mira"]);
});

/**
 * #88: the same text in different Unicode forms is one page. `Café` with a
 * precomposed `é` and with `e` plus a combining accent, and `Mira` with a
 * zero-width space pasted after it. Each title is kept as first typed.
 */
test("titles that differ only in Unicode form are one page", () => {
  const composed = "Café";
  const decomposed = "Café";
  const created = (id: string, page: string, text: string) =>
    event(`${NAMESPACE}block.created`, 1, { page, id, text });
  const state = [
    created("c1", composed, "first"),
    created("c2", decomposed, "second"),
    created("m1", "Mira", "hi"),
    created("d1", TODAY, "met [[Mira​]]"),
  ].reduce(reduce, empty());

  const cafe = getPage(view(state), decomposed);
  assert.equal(cafe.title, composed);
  assert.deepEqual(cafe.blocks.map((it) => it.id), ["c1", "c2"]);
  assert.deepEqual(searchPages(view(state), decomposed), [composed]);

  const references = getReferences(view(state), "Mira");
  assert.deepEqual(references[0].blocks.map((it) => it.id), ["d1"]);
  assert.deepEqual(searchPages(view(state), "mir"), ["Mira"]);
});

/**
 * #83: the renderer predicts a write onto the page it is showing, under the
 * title main sent, while the event names the page as the user's link spelt
 * it. Both have to land on the one page.
 */
test("a prediction files a block under any spelling of the page it is drawn on", () => {
  const page = { title: "Mira", blocks: [] };
  const create: PageEvent = {
    type: `${NAMESPACE}block.created`,
    payload: { page: "mira", id: "n", text: "new" },
  };
  const next = predict(page, [create]);
  assert.equal(next.title, "Mira");
  assert.deepEqual(next.blocks.map((it) => it.id), ["n"]);
});
