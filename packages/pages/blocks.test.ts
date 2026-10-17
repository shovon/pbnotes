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
import type { Block, PageEvent, Pages } from "./blocks.ts";

const TODAY = "2026-09-21";

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
  assert.deepEqual(reduce({}, event("something.else", 1, {})), {});
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
    {},
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
  assert.deepEqual(edited[TODAY], [
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
  assert.equal(elsewhere[TODAY][0].children[0].text, "again");
  assert.deepEqual(Object.keys(elsewhere), [TODAY]);
});

/**
 * #40: an event has one name, the namespaced one. A bare name from a log
 * that was never rewritten (#39) is not folded and not claimed by the gate,
 * so it is reported to the user as one this build cannot read.
 */
test("an event is folded under its namespaced name and no other", () => {
  const payload = { page: TODAY, id: "b1", text: "first" };
  const empty: Pages = {};

  assert.deepEqual(reduce(empty, event(`${NAMESPACE}block.created`, 1, payload)), {
    [TODAY]: [{ id: "b1", text: "first", children: [] }],
  });
  assert.equal(reduce(empty, event("block.created", 1, payload)), empty);
  // Only the exact prefix. A slash is what #37 first proposed and is not it.
  assert.equal(
    reduce(empty, event("github.com/shovon/pbnotes/block.created", 1, payload)),
    empty,
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
      {},
      event(`${NAMESPACE}block.created`, 1, { page: title, id: "b1", text: "hi" }),
    );
    assert.deepEqual(state[title], [{ id: "b1", text: "hi", children: [] }], title);
    assert.deepEqual(Object.keys(state), [title], title);
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
  ].reduce(reduce, {} as Pages);

  assert.equal(reduce(two, indent("y", "y")), two);
  const nested = reduce(two, indent("y", "x"));
  assert.equal(reduce(nested, indent("x", "y")), nested);
});
