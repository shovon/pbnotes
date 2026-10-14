/**
 * Run with: npm test
 *
 * The fold on its own: one event in, the whole view out, with no log, no
 * device and no project directory anywhere near it. That this file needs none
 * of those is the point of `blocks.ts` being separate from the store.
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
import type { PageEvent, Pages } from "./blocks.ts";
import type { Block } from "../pages.ts";

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
 * The shape every log already on disk was written in: a page on the events
 * that follow a creation. Nothing reads it any more, so there is no upcast to
 * exercise — what has to hold is that the id alone still reaches the block,
 * which is the whole claim that made dropping the field safe. No write path
 * produces these any more, so this is the only thing that would notice if
 * `reduce` ever went back to looking a page up.
 */
test("a v1 payload still folds, page and all", async () => {
  const created = reduce(
    {},
    event("block.created", 1, { page: TODAY, id: "b1", text: "first" }),
  );
  const nested = reduce(
    reduce(
      created,
      event("block.created", 1, { page: TODAY, id: "b2", text: "second" }),
    ),
    event("block.indented", 1, { page: TODAY, id: "b2", parent: "b1" }),
  );
  const edited = reduce(
    nested,
    event("block.edited", 1, { page: TODAY, id: "b2", text: "rewritten" }),
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
    event("block.edited", 1, { page: "Mira", id: "b2", text: "again" }),
  );
  assert.equal(elsewhere[TODAY][0].children[0].text, "again");
  assert.deepEqual(Object.keys(elsewhere), [TODAY]);
});

/**
 * #37: every event has a second name, and a log may hold either. What has to
 * hold is that the name changes nothing about what an event folds to, and
 * that the gate claims both — an event the gate does not claim is reported to
 * the user as one this build cannot read.
 */
test("an event folds the same under its namespaced name", () => {
  const log: [string, unknown][] = [
    ["block.created", { page: TODAY, id: "b1", text: "first" }],
    ["block.created", { page: TODAY, id: "b2", text: "second", after: "b1" }],
    ["block.created", { page: TODAY, id: "b3", text: "third", after: "b2" }],
    ["block.indented", { id: "b2", parent: "b1" }],
    ["block.indented", { id: "b3", parent: "b1" }],
    ["block.edited", { id: "b2", text: "rewritten" }],
    ["block.outdented", { id: "b2", after: "b1" }],
    ["block.deleted", { id: "b3" }],
  ];
  const fold = (prefix: string) =>
    log.reduce(
      (state, [type, payload]) =>
        reduce(state, event(prefix + type, 2, payload)),
      {} as Pages,
    );

  assert.deepEqual(fold(NAMESPACE), fold(""));
  assert.deepEqual(fold(NAMESPACE)[TODAY], [
    { id: "b1", text: "first", children: [] },
    { id: "b2", text: "rewritten", children: [] },
  ]);

  const handles: Record<string, number> = HANDLES;
  for (const type of new Set(log.map(([type]) => type))) {
    assert.equal(handles[NAMESPACE + type], handles[type]);
  }
  assert.equal(Object.keys(handles).length, 10);

  // Only the exact prefix. A slash is what #37 first proposed and is not it.
  assert.deepEqual(
    reduce({}, event("github.com/shovon/pbnotes/block.created", 1, log[0][1])),
    {},
  );
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
    type: "block.created",
    payload: { page: TODAY, id: "n", text: "new", after: "a" },
  };
  const created = predict(page, [create]);
  assert.deepEqual(
    created.blocks.map((it) => it.id),
    ["a", "n", "b"],
  );

  const indent: PageEvent = {
    type: "block.indented",
    payload: indented(created.blocks, "n") ?? assert.fail(),
  };
  const under = predict(page, [create, indent]);
  assert.deepEqual(under.blocks[0].children.map((it) => it.id), ["n"]);
  // First among its siblings now: nowhere further in.
  assert.equal(indented(under.blocks, "n"), undefined);

  const outdent: PageEvent = {
    type: "block.outdented",
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
